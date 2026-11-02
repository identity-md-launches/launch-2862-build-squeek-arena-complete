// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SqueekArena, IERC20Minimal} from "../src/SqueekArena.sol";

/// Minimal cheatcode interface so the suite needs no forge-std submodule.
interface Vm {
    function warp(uint256) external;
    function roll(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function setBlockhash(uint256, bytes32) external;
}

/// Test-only ERC-20 standing in for SQK inside the local EVM. It is never deployed anywhere.
contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external virtual returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

/// Re-enters claim() from inside transfer to prove the guard holds.
contract ReentrantToken is TestToken {
    SqueekArena public arena;
    uint256 public target;
    bool public armed;
    function arm(SqueekArena a, uint256 id) external { arena = a; target = id; armed = true; }
    function transfer(address to, uint256 a) external override returns (bool) {
        if (armed) { armed = false; arena.claim(target); }
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
}

contract SqueekArenaTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestToken tok;
    SqueekArena arena;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    function setUp() public {
        vm.warp(1_700_000_000);
        vm.roll(100);
        tok = new TestToken();
        arena = new SqueekArena(IERC20Minimal(address(tok)));
        address[3] memory ps = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            tok.mint(ps[i], 1000 ether);
            vm.prank(ps[i]);
            tok.approve(address(arena), type(uint256).max);
        }
    }

    function _eq(uint256 a, uint256 b, string memory m) internal pure { require(a == b, m); }

    function _bet(address p, uint8 h, uint256 amt) internal { vm.prank(p); arena.bet(h, amt); }

    function _closeAndRace(uint256 id, bytes32 hash) internal returns (uint8 winner) {
        vm.warp(arena.closeTime(id));
        arena.lock(id);
        (, , uint64 reveal, , , , , ) = arena.getRound(id);
        vm.roll(uint256(reveal) + 1);
        vm.setBlockhash(reveal, hash);
        arena.settle(id);
        (, , , , winner, , , ) = arena.getRound(id);
    }

    /// Find a block hash whose race is won by `want`.
    function _hashFor(uint256 id, uint8 want) internal view returns (bytes32) {
        for (uint256 i; i < 200; i++) {
            bytes32 h = keccak256(abi.encode("h", i));
            (uint8 w, ) = arena.raceFromSeed(keccak256(abi.encode(h, id, address(arena))));
            if (w == want) return h;
        }
        revert("no hash");
    }

    function test_betRecordsPools() public {
        _bet(alice, 0, 10 ether);
        _bet(bob, 1, 5 ether);
        _bet(alice, 0, 1 ether);
        (uint256 total, uint256[3] memory pools, , uint8 status, , , , ) = arena.getRound(0);
        _eq(total, 16 ether, "total");
        _eq(pools[0], 11 ether, "pool0");
        _eq(pools[1], 5 ether, "pool1");
        _eq(status, 0, "open");
        _eq(tok.balanceOf(address(arena)), 16 ether, "escrow");
    }

    function test_rejectsBadInput() public {
        vm.prank(alice);
        vm.expectRevert(SqueekArena.BadHamster.selector);
        arena.bet(3, 1 ether);
        vm.prank(alice);
        vm.expectRevert(SqueekArena.BetTooSmall.selector);
        arena.bet(0, 1e15);
    }

    function test_cannotLockBeforeClose() public {
        _bet(alice, 0, 1 ether);
        vm.warp(arena.closeTime(0) - 1);
        vm.expectRevert(SqueekArena.BettingStillOpen.selector);
        arena.lock(0);
    }

    function test_betsAfterCloseGoToNextRound() public {
        _bet(alice, 0, 1 ether);
        vm.warp(arena.closeTime(0));
        _bet(bob, 1, 2 ether);
        (uint256 t0, , , , , , , ) = arena.getRound(0);
        (uint256 t1, , , , , , , ) = arena.getRound(1);
        _eq(t0, 1 ether, "round0 unchanged");
        _eq(t1, 2 ether, "round1");
    }

    function test_settleBeforeRevealReverts() public {
        _bet(alice, 0, 1 ether);
        vm.warp(arena.closeTime(0));
        arena.lock(0);
        vm.expectRevert(SqueekArena.RevealBlockPending.selector);
        arena.settle(0);
    }

    function test_proportionalPayoutAndNoDoubleClaim() public {
        _bet(alice, 2, 30 ether);
        _bet(bob, 2, 10 ether);
        _bet(carol, 0, 60 ether);
        uint8 w = _closeAndRace(0, _hashFor(0, 2));
        _eq(w, 2, "golden wins");
        _eq(arena.claimable(0, alice), 75 ether, "alice 3/4 of 100");
        _eq(arena.claimable(0, bob), 25 ether, "bob 1/4 of 100");
        _eq(arena.claimable(0, carol), 0, "carol lost");
        vm.prank(alice); arena.claim(0);
        vm.prank(bob); arena.claim(0);
        _eq(tok.balanceOf(alice), 1045 ether, "alice paid");
        _eq(tok.balanceOf(bob), 1015 ether, "bob paid");
        _eq(tok.balanceOf(address(arena)), 0, "pool fully paid, no fee");
        (uint256 wag, uint256 won, , uint32 nb, uint32 nw) = arena.stats(alice);
        _eq(wag, 30 ether, "alice wagered");
        _eq(won, 75 ether, "alice won");
        _eq(nb, 1, "alice bets");
        _eq(nw, 1, "alice wins");
        _eq(arena.playerCount(), 3, "players");
        (address[] memory addrs, ) = arena.playersPage(1, 10);
        _eq(addrs.length, 2, "page");
        _eq(arena.roundsOf(carol).length, 1, "carol rounds");
        vm.prank(alice);
        vm.expectRevert(SqueekArena.AlreadyClaimed.selector);
        arena.claim(0);
        vm.prank(carol);
        vm.expectRevert(SqueekArena.NothingToClaim.selector);
        arena.claim(0);
    }

    function test_refundWhenNobodyBackedWinner() public {
        _bet(alice, 0, 7 ether);
        _bet(bob, 0, 3 ether);
        uint8 w = _closeAndRace(0, _hashFor(0, 1));
        _eq(w, 1, "white wins");
        (, , , uint8 status, , uint8 reason, , ) = arena.getRound(0);
        _eq(status, 3, "refunding");
        _eq(reason, 1, "no winning bets");
        vm.prank(alice); arena.claim(0);
        vm.prank(bob); arena.claim(0);
        _eq(tok.balanceOf(alice), 1000 ether, "alice refunded");
        _eq(tok.balanceOf(bob), 1000 ether, "bob refunded");
    }

    function test_refundWhenRevealExpired() public {
        _bet(alice, 0, 4 ether);
        _bet(bob, 1, 6 ether);
        vm.warp(arena.closeTime(0));
        arena.lock(0);
        (, , uint64 reveal, , , , , ) = arena.getRound(0);
        vm.roll(uint256(reveal) + 300);
        arena.settle(0);
        (, , , uint8 status, , uint8 reason, , ) = arena.getRound(0);
        _eq(status, 3, "refunding");
        _eq(reason, 2, "expired");
        vm.prank(bob); arena.claim(0);
        _eq(tok.balanceOf(bob), 1000 ether, "bob refunded");
        vm.expectRevert(SqueekArena.NotLocked.selector);
        arena.settle(0);
    }

    function test_resultCannotBeRerun() public {
        _bet(alice, 0, 1 ether);
        _closeAndRace(0, _hashFor(0, 0));
        vm.expectRevert(SqueekArena.NotLocked.selector);
        arena.settle(0);
        vm.expectRevert(SqueekArena.NotOpen.selector);
        arena.lock(0);
    }

    function test_cannotClaimUnfinished() public {
        _bet(alice, 0, 1 ether);
        vm.prank(alice);
        vm.expectRevert(SqueekArena.NotFinished.selector);
        arena.claim(0);
    }

    function test_emptyRoundCannotLock() public {
        vm.warp(arena.closeTime(0));
        vm.expectRevert(SqueekArena.EmptyRound.selector);
        arena.lock(0);
    }

    function test_timesInRangeAndWinnerIsLongest() public view {
        for (uint256 i; i < 300; i++) {
            (uint8 w, uint32[3] memory t) = arena.raceFromSeed(keccak256(abi.encode(i)));
            for (uint256 j; j < 3; j++) {
                require(t[j] >= 20_000 && t[j] <= 30_000, "range");
                require(t[w] >= t[j], "winner runs longest");
            }
        }
    }

    function test_winnerDistributionRoughlyEqual() public view {
        uint256[3] memory wins;
        uint256 n = 3000;
        for (uint256 i; i < n; i++) {
            (uint8 w, ) = arena.raceFromSeed(keccak256(abi.encode("dist", i)));
            wins[w]++;
        }
        for (uint256 j; j < 3; j++) require(wins[j] > 900 && wins[j] < 1100, "each near 1000 of 3000");
    }

    function test_reentrantClaimBlocked() public {
        ReentrantToken rt = new ReentrantToken();
        SqueekArena a2 = new SqueekArena(IERC20Minimal(address(rt)));
        rt.mint(alice, 10 ether);
        vm.prank(alice); rt.approve(address(a2), type(uint256).max);
        vm.prank(alice); a2.bet(0, 1 ether);
        vm.warp(a2.closeTime(0));
        a2.lock(0);
        (, , uint64 reveal, , , , , ) = a2.getRound(0);
        vm.roll(uint256(reveal) + 300); // expire -> refund path
        a2.settle(0);
        rt.arm(a2, 0);
        vm.prank(alice);
        vm.expectRevert(SqueekArena.Reentrancy.selector);
        a2.claim(0);
    }
}
