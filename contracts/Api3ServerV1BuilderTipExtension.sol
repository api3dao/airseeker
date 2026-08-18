// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "./interfaces/IApi3ServerV1BuilderTipExtension.sol";

/// @title Api3ServerV1 extension that tips the block builder
/// @notice Batches calls to Api3ServerV1 and transfers the value sent along
/// with the transaction to the block builder as a tip. This is intended to
/// be used on chains whose block builders order transactions by the total
/// value that they add to the block, where a data feed update transaction
/// may be delayed or dropped in favor of more profitable transactions even
/// when its gas price is competitive. Callers that do not intend to tip
/// should call the respective multicall function of Api3ServerV1 directly
/// instead, which is also cheaper.
/// @dev The batched calldata is identical to what the multicall functions
/// of Api3ServerV1 receive. However, unlike SelfMulticall of Api3ServerV1,
/// which delegatecalls into itself, this contract makes external calls to
/// Api3ServerV1, which means Api3ServerV1 will see this contract as the
/// sender. Since the tip is transferred within the transaction, it is only
/// paid if the transaction does not revert, unlike the priority fee.
contract Api3ServerV1BuilderTipExtension is IApi3ServerV1BuilderTipExtension {
    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;

    /// @param api3ServerV1_ Api3ServerV1 address
    constructor(address api3ServerV1_) {
        require(api3ServerV1_ != address(0), "Api3ServerV1 address zero");
        api3ServerV1 = api3ServerV1_;
    }

    /// @notice Batches calls to Api3ServerV1, reverting as soon as one of
    /// the batched calls reverts, and tips the block builder
    /// @param data Array of calldata of batched calls
    /// @return returndata Array of returndata of batched calls
    function multicallAndTip(
        bytes[] calldata data
    ) external payable override returns (bytes[] memory returndata) {
        require(msg.value > 0, "Tip amount zero");
        uint256 callCount = data.length;
        returndata = new bytes[](callCount);
        for (uint256 ind = 0; ind < callCount; ) {
            bool success;
            // solhint-disable-next-line avoid-low-level-calls
            (success, returndata[ind]) = api3ServerV1.call(data[ind]);
            if (!success) {
                bytes memory returndataWithRevertData = returndata[ind];
                if (returndataWithRevertData.length > 0) {
                    // Adapted from OpenZeppelin's Address.sol
                    // solhint-disable-next-line no-inline-assembly
                    assembly {
                        let returndata_size := mload(returndataWithRevertData)
                        revert(
                            add(32, returndataWithRevertData),
                            returndata_size
                        )
                    }
                } else {
                    revert("Multicall: No revert string");
                }
            }
            unchecked {
                ind++;
            }
        }
        _tipBuilder();
    }

    /// @notice Batches calls to Api3ServerV1 without reverting if any of
    /// the batched calls reverts, and tips the block builder
    /// @param data Array of calldata of batched calls
    /// @return successes Array of success conditions of batched calls
    /// @return returndata Array of returndata of batched calls
    function tryMulticallAndTip(
        bytes[] calldata data
    )
        external
        payable
        override
        returns (bool[] memory successes, bytes[] memory returndata)
    {
        require(msg.value > 0, "Tip amount zero");
        uint256 callCount = data.length;
        successes = new bool[](callCount);
        returndata = new bytes[](callCount);
        for (uint256 ind = 0; ind < callCount; ) {
            // solhint-disable-next-line avoid-low-level-calls
            (successes[ind], returndata[ind]) = api3ServerV1.call(data[ind]);
            unchecked {
                ind++;
            }
        }
        _tipBuilder();
    }

    /// @dev Transfers the value sent along with the transaction to
    /// `block.coinbase`, which is assumed to be the address that the block
    /// builder receives payments at. A low-level call is used because the
    /// builder may be receiving payments at a contract
    function _tipBuilder() private {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = block.coinbase.call{value: msg.value}("");
        require(success, "Tip transfer reverted");
        emit TippedBuilder(msg.sender, block.coinbase, msg.value);
    }
}
