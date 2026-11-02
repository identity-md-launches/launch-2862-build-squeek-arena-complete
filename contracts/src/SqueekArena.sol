// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SQUEEK ARENA
/// @notice Three hamsters (0 BROWN, 1 WHITE, 2 GOLDEN) race in back-to-back rounds. Players stake
///         SQK on one hamster while a round's betting window is open. When the window closes,
///         anyone may lock the round, which commits it to the hash of a block that does not exist
///         yet. Once that block is mined, anyone may settle: three running times are derived from
///         the block hash and the longest-running hamster wins. Winning bettors split the entire
///         pool in proportion to their stake on the winner.
/// @dev    There is no owner, no admin, no fee, no pause and no upgrade path. Nobody can move
///         escrowed SQK except through claim(), and nobody can influence a result after betting
///         closes. If no one backed the winner, or the round cannot be settled within the 256-block
///         blockhash window, every bettor is refunded in full.
contract SqueekArena {
    // ---------------------------------------------------------------- constants

    /// @notice Length of each round's betting window, in seconds.
    uint256 public constant ROUND_LENGTH = 300;
    /// @notice Blocks between lock and the block whose hash decides the race.
    uint256 public constant REVEAL_DELAY = 2;
    /// @notice Smallest accepted bet (0.01 SQK).
    uint256 public constant MIN_BET = 1e16;
    /// @notice Fee taken from pools. Always zero: the whole pool goes to bettors.
    uint256 public constant FEE_BPS = 0;
    uint256 public constant HAMSTERS = 3;
    /// @notice Running times are between BASE_TIME_MS and BASE_TIME_MS + TIME_SPREAD_MS.
    uint256 public constant BASE_TIME_MS = 20_000;
    uint256 public constant TIME_SPREAD_MS = 10_000;

    uint8 public constant STATUS_OPEN = 0; // taking bets, or closed and waiting for lock()
    uint8 public constant STATUS_LOCKED = 1; // waiting for the reveal block
    uint8 public constant STATUS_SETTLED = 2; // winner decided, winners claim
    uint8 public constant STATUS_REFUNDING = 3; // everyone claims their stake back

    uint8 public constant REFUND_NO_WINNING_BETS = 1;
    uint8 public constant REFUND_EXPIRED = 2;

    // ---------------------------------------------------------------- storage

    IERC20Minimal public immutable token;
    uint256 public immutable genesis;
    uint256 public immutable deployBlock;

    struct Round {
        uint256 totalPool;
        uint256[3] pools;
        uint64 revealBlock;
        uint8 status;
        uint8 winner;
        uint8 refundReason;
        uint32[3] timesMs;
        bytes32 seed;
    }

    mapping(uint256 => Round) internal _rounds;
    mapping(uint256 => mapping(address => uint256[3])) internal _stakes;
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice Lifetime totals per player, kept onchain so history and the leaderboard need no indexer.
    struct PlayerStats {
        uint256 wagered;
        uint256 won;
        uint256 refunded;
        uint32 bets;
        uint32 wins;
    }

    mapping(address => PlayerStats) public stats;
    mapping(address => uint256[]) internal _playerRounds;
    mapping(uint256 => mapping(address => bool)) internal _joined;
    address[] internal _players;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------- events

    event BetPlaced(uint256 indexed roundId, address indexed player, uint8 indexed hamster, uint256 amount);
    event RoundLocked(uint256 indexed roundId, uint256 revealBlock);
    event RoundRaced(uint256 indexed roundId, uint8 winner, uint32[3] timesMs, bytes32 seed);
    event RoundRefunding(uint256 indexed roundId, uint8 reason);
    event Claimed(uint256 indexed roundId, address indexed player, uint256 amount, bool refund);

    // ---------------------------------------------------------------- errors

    error BadHamster();
    error BetTooSmall();
    error TransferFailed();
    error BettingStillOpen();
    error NotOpen();
    error NotLocked();
    error EmptyRound();
    error RevealBlockPending();
    error NotFinished();
    error AlreadyClaimed();
    error NothingToClaim();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IERC20Minimal token_) {
        token = token_;
        genesis = block.timestamp;
        deployBlock = block.number;
    }

    // ---------------------------------------------------------------- views

    /// @notice The round currently taking bets.
    function currentRoundId() public view returns (uint256) {
        return (block.timestamp - genesis) / ROUND_LENGTH;
    }

    /// @notice Timestamp at which betting on `roundId` closes.
    function closeTime(uint256 roundId) public view returns (uint256) {
        return genesis + (roundId + 1) * ROUND_LENGTH;
    }

    function getRound(uint256 roundId)
        external
        view
        returns (
            uint256 totalPool,
            uint256[3] memory pools,
            uint64 revealBlock,
            uint8 status,
            uint8 winner,
            uint8 refundReason,
            uint32[3] memory timesMs,
            bytes32 seed
        )
    {
        Round storage r = _rounds[roundId];
        return (r.totalPool, r.pools, r.revealBlock, r.status, r.winner, r.refundReason, r.timesMs, r.seed);
    }

    function stakesOf(uint256 roundId, address player) external view returns (uint256[3] memory) {
        return _stakes[roundId][player];
    }

    function playerCount() external view returns (uint256) {
        return _players.length;
    }

    /// @notice A page of players with their lifetime stats, for the leaderboard.
    function playersPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addrs, PlayerStats[] memory st)
    {
        uint256 n = _players.length;
        if (offset > n) offset = n;
        uint256 end = offset + limit > n ? n : offset + limit;
        addrs = new address[](end - offset);
        st = new PlayerStats[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            addrs[i - offset] = _players[i];
            st[i - offset] = stats[_players[i]];
        }
    }

    /// @notice Every round `player` has bet in, oldest first.
    function roundsOf(address player) external view returns (uint256[] memory) {
        return _playerRounds[player];
    }

    /// @notice What `player` can claim from `roundId` right now (0 if nothing or already claimed).
    function claimable(uint256 roundId, address player) public view returns (uint256) {
        if (claimed[roundId][player]) return 0;
        Round storage r = _rounds[roundId];
        uint256[3] storage s = _stakes[roundId][player];
        if (r.status == STATUS_SETTLED) {
            uint256 stake = s[r.winner];
            if (stake == 0) return 0;
            return (stake * r.totalPool) / r.pools[r.winner];
        }
        if (r.status == STATUS_REFUNDING) return s[0] + s[1] + s[2];
        return 0;
    }

    /// @notice Running times and winner for a seed. Each time is drawn independently from the same
    ///         range, so the three hamsters are symmetric and each wins with probability 1/3. A tie
    ///         on milliseconds is broken by the full 256-bit draw, which is just as symmetric.
    function raceFromSeed(bytes32 seed) public pure returns (uint8 winner, uint32[3] memory timesMs) {
        uint256 bestTime;
        uint256 bestDraw;
        for (uint8 i = 0; i < HAMSTERS; i++) {
            uint256 draw = uint256(keccak256(abi.encode(seed, i)));
            uint256 t = BASE_TIME_MS + (draw % (TIME_SPREAD_MS + 1));
            timesMs[i] = uint32(t);
            if (i == 0 || t > bestTime || (t == bestTime && draw > bestDraw)) {
                bestTime = t;
                bestDraw = draw;
                winner = i;
            }
        }
    }

    // ---------------------------------------------------------------- actions

    /// @notice Stake `amount` SQK on `hamster` in the current round. Requires an SQK approval.
    function bet(uint8 hamster, uint256 amount) external nonReentrant {
        if (hamster >= HAMSTERS) revert BadHamster();
        if (amount < MIN_BET) revert BetTooSmall();
        uint256 roundId = currentRoundId();
        Round storage r = _rounds[roundId];
        // A round can only be locked after it closes, so the current round is always open.
        if (r.status != STATUS_OPEN) revert NotOpen();

        uint256 before = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 received = token.balanceOf(address(this)) - before;
        if (received < MIN_BET) revert BetTooSmall();

        r.totalPool += received;
        r.pools[hamster] += received;
        _stakes[roundId][msg.sender][hamster] += received;

        PlayerStats storage ps = stats[msg.sender];
        if (ps.bets == 0) _players.push(msg.sender);
        ps.bets += 1;
        ps.wagered += received;
        if (!_joined[roundId][msg.sender]) {
            _joined[roundId][msg.sender] = true;
            _playerRounds[msg.sender].push(roundId);
        }
        emit BetPlaced(roundId, msg.sender, hamster, received);
    }

    /// @notice Close a finished round to further change and commit it to a future block hash.
    ///         Callable by anyone once the round's betting window has ended.
    function lock(uint256 roundId) external {
        Round storage r = _rounds[roundId];
        if (block.timestamp < closeTime(roundId)) revert BettingStillOpen();
        if (r.status != STATUS_OPEN) revert NotOpen();
        if (r.totalPool == 0) revert EmptyRound();
        uint256 revealBlock = block.number + REVEAL_DELAY;
        r.revealBlock = uint64(revealBlock);
        r.status = STATUS_LOCKED;
        emit RoundLocked(roundId, revealBlock);
    }

    /// @notice Run the race from the reveal block's hash. Callable by anyone after the reveal
    ///         block is mined. If more than 256 blocks have passed the hash is gone and the round
    ///         refunds everyone instead.
    function settle(uint256 roundId) external {
        Round storage r = _rounds[roundId];
        if (r.status != STATUS_LOCKED) revert NotLocked();
        if (block.number <= r.revealBlock) revert RevealBlockPending();

        bytes32 h = blockhash(r.revealBlock);
        if (h == bytes32(0)) {
            r.status = STATUS_REFUNDING;
            r.refundReason = REFUND_EXPIRED;
            emit RoundRefunding(roundId, REFUND_EXPIRED);
            return;
        }

        bytes32 seed = keccak256(abi.encode(h, roundId, address(this)));
        (uint8 winner, uint32[3] memory timesMs) = raceFromSeed(seed);
        r.seed = seed;
        r.winner = winner;
        r.timesMs = timesMs;
        emit RoundRaced(roundId, winner, timesMs, seed);

        if (r.pools[winner] == 0) {
            r.status = STATUS_REFUNDING;
            r.refundReason = REFUND_NO_WINNING_BETS;
            emit RoundRefunding(roundId, REFUND_NO_WINNING_BETS);
        } else {
            r.status = STATUS_SETTLED;
        }
    }

    /// @notice Collect winnings or a refund from a finished round. Each address claims once.
    function claim(uint256 roundId) external nonReentrant {
        if (claimed[roundId][msg.sender]) revert AlreadyClaimed();
        uint8 status = _rounds[roundId].status;
        if (status != STATUS_SETTLED && status != STATUS_REFUNDING) revert NotFinished();
        uint256 amount = claimable(roundId, msg.sender);
        if (amount == 0) revert NothingToClaim();
        claimed[roundId][msg.sender] = true;
        PlayerStats storage ps = stats[msg.sender];
        if (status == STATUS_REFUNDING) {
            ps.refunded += amount;
        } else {
            ps.won += amount;
            ps.wins += 1;
        }
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(roundId, msg.sender, amount, status == STATUS_REFUNDING);
    }
}
