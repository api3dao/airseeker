// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IApi3ServerV1BuilderTipExtension {
    event TippedBuilder(
        address indexed sender,
        address indexed builder,
        uint256 amount
    );

    function multicallAndTip(
        bytes[] calldata data
    ) external payable returns (bytes[] memory returndata);

    function tryMulticallAndTip(
        bytes[] calldata data
    )
        external
        payable
        returns (bool[] memory successes, bytes[] memory returndata);

    function api3ServerV1() external view returns (address);
}
