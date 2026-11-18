const solc = require('solc');
const fs = require('fs');
const path = require('path');

function compile() {
    process.stdout.write('Compiling Solidity contracts...\n');

    const contractsDir = path.resolve(__dirname, '..', 'contracts');
    const sources = {
        'MosooPrivacyPool.sol': { content: fs.readFileSync(path.join(contractsDir, 'MosooPrivacyPool.sol'), 'utf8') },
        'MerkleTreeWithHistory.sol': { content: fs.readFileSync(path.join(contractsDir, 'MerkleTreeWithHistory.sol'), 'utf8') },
        'MockERC20.sol': { content: fs.readFileSync(path.join(contractsDir, 'MockERC20.sol'), 'utf8') }
    };

    const input = {
        language: 'Solidity',
        sources,
        settings: {
            optimizer: { enabled: true, runs: 200 },
            outputSelection: {
                '*': {
                    '*': ['evm.bytecode', 'abi']
                }
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    if (output.errors) {
        let hasError = false;
        for (const err of output.errors) {
            if (err.severity === 'error') {
                console.error(err.formattedMessage);
                hasError = true;
            } else {
                console.warn(err.formattedMessage);
            }
        }
        if (hasError) {
            process.exit(1);
        }
    }

    const poolBytecode = output.contracts['MosooPrivacyPool.sol']['MosooPrivacyPool'].evm.bytecode.object;
    const bytecodeSize = poolBytecode.length / 2;
    process.stdout.write(`Compilation successful. MosooPrivacyPool bytecode size: ${bytecodeSize} bytes (max: 24576 bytes).\n`);
}

compile();
