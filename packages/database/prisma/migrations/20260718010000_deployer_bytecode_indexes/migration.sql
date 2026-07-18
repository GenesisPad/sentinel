-- Milestone 6 (deployer and wallet intelligence): index the columns used to look up a
-- deployer's prior scans and reused runtime bytecode across scans.
CREATE INDEX "Token_deployerAddress_idx" ON "Token" ("deployerAddress");
CREATE INDEX "Contract_bytecodeHash_idx" ON "Contract" ("bytecodeHash");
