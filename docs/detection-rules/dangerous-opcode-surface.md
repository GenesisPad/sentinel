# Dangerous Opcode Surface

- Detector ID: `dangerous-opcode-surface`
- Version: `0.1.0`
- Finding codes: `EIP1167_MINIMAL_PROXY_DETECTED` (`INFO`), `DELEGATECALL_OPCODE_PRESENT` (`MEDIUM`), `SELFDESTRUCT_OPCODE_PRESENT` (`HIGH`)
- Evidence: bytecode opcode-stream scan result (`BYTECODE` evidence type).

This detector walks the contract's runtime bytecode as an actual instruction stream — tracking `PUSH1`-`PUSH32` (`0x60`-`0x7f`) immediate-data lengths and skipping over that data — rather than substring-searching for a byte value or a function selector. This matters because a byte like `0xf4` (`DELEGATECALL`) or `0xff` (`SELFDESTRUCT`) can legitimately appear inside another instruction's pushed constant (e.g. an address or a packed value) without ever being executed as that opcode. A naive byte-presence scan would misreport those as findings; this detector will not, because it only counts a byte as `DELEGATECALL`/`SELFDESTRUCT` when the opcode walk lands on it as an actual instruction boundary.

`DELEGATECALL` presence is reported at `MEDIUM` severity/confidence because it is *required* by essentially every proxy pattern (see `eip1967-proxy-storage.md`) and is not inherently malicious — the technical explanation on the finding says so explicitly and recommends cross-checking against proxy findings before treating it as suspicious.

`SELFDESTRUCT` presence is reported at `HIGH` severity (still `MEDIUM` confidence, since reachability is unknown) because it is unusual in a standard token contract and can remove code or forcibly redirect the contract's native balance.

Known limitations:

- Presence does not prove reachability from an externally callable function, nor who controls the call target (for `DELEGATECALL`) or the triggering condition (for `SELFDESTRUCT`). This is opcode-surface evidence, not an exploitability proof — consistent with the project rule that function/opcode presence alone is never sufficient evidence of a serious finding.
- Does not decode `CALLCODE` (`0xf2`, deprecated but similarly dangerous) or attempt any control-flow/reachability analysis.
- Bytecode after immutable/constructor-argument-appended metadata (Solidity's trailing CBOR metadata hash) is not specially excluded; in the unlikely event a metadata blob byte-aligns to look like an opcode boundary, this could theoretically misclassify a byte within it. Not observed in practice against real Solidity output but noted as a known limitation of a naive linear opcode walk (a full jump-destination-aware disassembler would be more precise and is future work).
