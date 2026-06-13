// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {AggregatorV3Interface} from "chainlink/AggregatorV3Interface.sol";
import {ISeikineTreasury} from "./interfaces/ISeikineTreasury.sol";
import {ISeikineCollateralVault} from "./interfaces/ISeikineCollateralVault.sol";

/// @title  SeikineLendingController
/// @notice Public baseline of the Seikine lending controller — the contract
///         the live frontend talks to on Sepolia (deployment `round-1.7-fixed`,
///         0xaAb9…527A). This file reproduces that contract's *external ABI*
///         (functions, config structs, the `PriceFeedStale()` error) and its
///         oracle-read seam. Per-asset accounting is kept in baseline form;
///         the production interest-index accrual, yield routing, and reserve
///         logic live with the private treasury/vault implementations and are
///         reached here only through interfaces, so the public contract set
///         compiles and deploys with no private file present.
///
/// @dev    CIRCUIT-BREAKER HOST. The Chainlink Data Feeds circuit breaker (the
///         hackathon's new on-chain work) hardens `_readPrice` below: staleness
///         windows and price-bound / deviation guards that make every USD view
///         fail closed via `PriceFeedStale()` rather than price off a dead or
///         manipulated feed. The breaker tests live in test/CircuitBreaker.t.sol.
contract SeikineLendingController {
    // ─── Config structs (ABI-compatible with the deployed contract) ────────

    struct CollateralVaultConfig {
        bool supported;
        uint16 ltvBps;
        uint16 liqThresholdBps;
        uint16 liqBonusBps;
        address priceFeed;
        uint8 feedDecimals;
        uint8 assetDecimals;
    }

    struct DebtAssetConfig {
        bool supported;
        uint16 ltvBps;
        uint16 liqThresholdBps;
        uint16 liqBonusBps;
        address priceFeed;
        uint8 feedDecimals;
        uint8 assetDecimals;
        uint256 globalDebtIndex;
        uint256 lastAccrualTimestamp;
    }

    // ─── Constants ──────────────────────────────────────────────────────────

    uint256 internal constant BPS = 10_000; // 10000 bps = 100%
    uint256 internal constant WAD = 1e18; // USD figures are 1e18-scaled
    uint256 internal constant HEALTH_INFINITE = type(uint256).max; // no-debt sentinel

    // ─── Storage ──────────────────────────────────────────────────────────

    address public owner;
    bool public paused;
    ISeikineTreasury public treasury;

    /// @notice Max age (seconds) a Chainlink answer may have before
    ///         `_readPrice` trips the breaker. Tightened by the hackathon work.
    uint256 public maxFeedStaleness;

    mapping(address => CollateralVaultConfig) public collateralVaultConfig;
    mapping(address => DebtAssetConfig) public debtAssetConfig;

    // Registries so the aggregate USD views can enumerate active markets.
    address[] public collateralVaults;
    address[] public debtAssets;

    // Baseline debt principal, in each asset's own decimals.
    mapping(address => mapping(address => uint256)) internal _debtPrincipal;

    // ─── Events ─────────────────────────────────────────────────────────────

    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed payer, address indexed onBehalfOf, address indexed asset, uint256 amount);
    event CollateralLocked(address indexed user, address indexed vault, uint256 shares);
    event CollateralUnlocked(address indexed user, address indexed vault, uint256 shares);
    event CollateralVaultConfigured(address indexed vault, bool supported);
    event DebtAssetConfigured(address indexed asset, bool supported);
    event PausedSet(bool paused);

    // ─── Errors ───────────────────────────────────────────────────────────

    /// @dev selector 0x216cc5f5 — the breaker's fail-closed signal, surfaced by
    ///      the frontend (useUserPosition) to fall back to a client projection.
    error PriceFeedStale();
    error NotOwner();
    error IsPaused();
    error Unsupported();
    error InsufficientCollateral();

    // ─── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address treasury_, uint256 maxFeedStaleness_) {
        owner = msg.sender;
        treasury = ISeikineTreasury(treasury_);
        maxFeedStaleness = maxFeedStaleness_;
    }

    // ─── State-changing: collateral ─────────────────────────────────────────

    /// @notice Lock vault shares as borrow collateral.
    function lockForBorrow(address vault, uint256 shares) external whenNotPaused {
        if (!collateralVaultConfig[vault].supported) revert Unsupported();
        ISeikineCollateralVault(vault).lockShares(msg.sender, shares);
        emit CollateralLocked(msg.sender, vault, shares);
    }

    /// @notice Release locked shares, reverting if it would leave the account
    ///         under its liquidation threshold (or if an oracle is stale).
    function unlock(address vault, uint256 shares) external whenNotPaused {
        if (!collateralVaultConfig[vault].supported) revert Unsupported();
        ISeikineCollateralVault(vault).unlockShares(msg.sender, shares);
        if (userTotalDebtUSD(msg.sender) > 0 && userHealthFactorBps(msg.sender) < BPS) {
            revert InsufficientCollateral();
        }
        emit CollateralUnlocked(msg.sender, vault, shares);
    }

    // ─── State-changing: debt ───────────────────────────────────────────────

    /// @notice Borrow `amount` of `asset` against locked collateral.
    function borrow(address asset, uint256 amount) external whenNotPaused {
        if (!debtAssetConfig[asset].supported) revert Unsupported();
        _debtPrincipal[msg.sender][asset] += amount;
        // Health check after accrual. Reverts (unwinding the borrow) if it
        // breaches borrow capacity, or PriceFeedStale() via _readPrice if any
        // required oracle is stale — the breaker fails the borrow closed.
        if (userTotalDebtUSD(msg.sender) > userMaxBorrowUSD(msg.sender)) {
            revert InsufficientCollateral();
        }
        treasury.disburse(asset, msg.sender, amount);
        emit Borrow(msg.sender, asset, amount);
    }

    /// @notice Repay `asset` debt for `onBehalfOf`. Pass `type(uint256).max`
    ///         to repay the full outstanding balance.
    function repay(address asset, uint256 amount, address onBehalfOf)
        external
        whenNotPaused
        returns (uint256 actualRepaid)
    {
        uint256 debt = _debtPrincipal[onBehalfOf][asset];
        actualRepaid = amount > debt ? debt : amount;
        _debtPrincipal[onBehalfOf][asset] = debt - actualRepaid;
        actualRepaid = treasury.collect(asset, msg.sender, actualRepaid);
        emit Repay(msg.sender, onBehalfOf, asset, actualRepaid);
    }

    // ─── Per-user views ───────────────────────────────────────────────────

    /// @notice Outstanding principal for (`user`, `asset`).
    /// @dev    Baseline returns stored principal. Production scales by
    ///         debtAssetConfig.globalDebtIndex to accrue interest; that lives
    ///         with the private treasury wiring.
    function currentDebt(address user, address asset) external view returns (uint256) {
        return _debtPrincipal[user][asset];
    }

    /// @notice Total collateral value, USD 1e18-scaled.
    function userTotalCollateralUSD(address user) public view returns (uint256 total) {
        uint256 n = collateralVaults.length;
        for (uint256 i; i < n; ++i) {
            total += _collateralUSD(user, collateralVaults[i]);
        }
    }

    /// @notice Total debt value, USD 1e18-scaled.
    function userTotalDebtUSD(address user) public view returns (uint256 total) {
        uint256 n = debtAssets.length;
        for (uint256 i; i < n; ++i) {
            total += _debtUSD(user, debtAssets[i]);
        }
    }

    /// @notice Borrow capacity (Σ collateralUSD · LTV), USD 1e18-scaled.
    function userMaxBorrowUSD(address user) public view returns (uint256 total) {
        uint256 n = collateralVaults.length;
        for (uint256 i; i < n; ++i) {
            address v = collateralVaults[i];
            CollateralVaultConfig memory c = collateralVaultConfig[v];
            if (!c.supported) continue;
            total += (_collateralUSD(user, v) * c.ltvBps) / BPS;
        }
    }

    /// @notice Health factor in bps (10000 = 1.00). `type(uint256).max` = no debt.
    function userHealthFactorBps(address user) public view returns (uint256) {
        uint256 debt = userTotalDebtUSD(user);
        if (debt == 0) return HEALTH_INFINITE;
        return (_liqWeightedCollateralUSD(user) * BPS) / debt;
    }

    /// @notice True once the account's health factor drops below 1.00.
    function isLiquidatable(address user) external view returns (bool) {
        if (userTotalDebtUSD(user) == 0) return false;
        return userHealthFactorBps(user) < BPS;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    function setCollateralVaultConfig(address vault, CollateralVaultConfig calldata cfg) external onlyOwner {
        if (!collateralVaultConfig[vault].supported && cfg.supported) {
            collateralVaults.push(vault);
        }
        collateralVaultConfig[vault] = cfg;
        emit CollateralVaultConfigured(vault, cfg.supported);
    }

    function setDebtAssetConfig(address asset, DebtAssetConfig calldata cfg) external onlyOwner {
        if (!debtAssetConfig[asset].supported && cfg.supported) {
            debtAssets.push(asset);
        }
        debtAssetConfig[asset] = cfg;
        emit DebtAssetConfigured(asset, cfg.supported);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setMaxFeedStaleness(uint256 seconds_) external onlyOwner {
        maxFeedStaleness = seconds_;
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = ISeikineTreasury(treasury_);
    }

    function collateralVaultsLength() external view returns (uint256) {
        return collateralVaults.length;
    }

    function debtAssetsLength() external view returns (uint256) {
        return debtAssets.length;
    }

    // ─── Internal: pricing + the circuit-breaker seam ───────────────────────

    /// @dev THE BREAKER SEAM. Reads a Chainlink feed and fails closed on a
    ///      stale or non-positive answer. The hackathon breaker extends the
    ///      guard set here (deviation bounds, min/max price, per-feed windows);
    ///      every addition reverts `PriceFeedStale()` so callers degrade safely.
    function _readPrice(address feed, uint8 feedDecimals) internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        if (answer <= 0) revert PriceFeedStale();
        if (block.timestamp - updatedAt > maxFeedStaleness) revert PriceFeedStale();
        return _scaleTo18(uint256(answer), feedDecimals);
    }

    function _collateralUSD(address user, address vault) internal view returns (uint256) {
        CollateralVaultConfig memory c = collateralVaultConfig[vault];
        if (!c.supported) return 0;
        uint256 shares = ISeikineCollateralVault(vault).balanceOf(user);
        if (shares == 0) return 0;
        uint256 assets = ISeikineCollateralVault(vault).convertToAssets(shares);
        uint256 priceWad = _readPrice(c.priceFeed, c.feedDecimals);
        return (_scaleTo18(assets, c.assetDecimals) * priceWad) / WAD;
    }

    function _debtUSD(address user, address asset) internal view returns (uint256) {
        DebtAssetConfig memory d = debtAssetConfig[asset];
        if (!d.supported) return 0;
        uint256 principal = _debtPrincipal[user][asset];
        if (principal == 0) return 0;
        uint256 priceWad = _readPrice(d.priceFeed, d.feedDecimals);
        return (_scaleTo18(principal, d.assetDecimals) * priceWad) / WAD;
    }

    function _liqWeightedCollateralUSD(address user) internal view returns (uint256 total) {
        uint256 n = collateralVaults.length;
        for (uint256 i; i < n; ++i) {
            address v = collateralVaults[i];
            CollateralVaultConfig memory c = collateralVaultConfig[v];
            if (!c.supported) continue;
            total += (_collateralUSD(user, v) * c.liqThresholdBps) / BPS;
        }
    }

    /// @dev Scale a value from `dec` decimals to 18.
    function _scaleTo18(uint256 v, uint8 dec) internal pure returns (uint256) {
        if (dec == 18) return v;
        if (dec < 18) return v * (10 ** (18 - dec));
        return v / (10 ** (dec - 18));
    }
}
