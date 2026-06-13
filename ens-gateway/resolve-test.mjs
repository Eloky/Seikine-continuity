import { createPublicClient, http, encodeFunctionData, decodeAbiParameters, namehash } from 'viem';
import { sepolia } from 'viem/chains';

const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0';
const client = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) });

const textAbi = [{ name: 'text', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
  outputs: [{ type: 'string' }] }];
const resolveAbi = [{ name: 'resolve', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'data', type: 'bytes' }],
  outputs: [{ type: 'bytes' }] }];

async function resolveText(name, key) {
  const node = namehash(name);
  const data = encodeFunctionData({ abi: textAbi, functionName: 'text', args: [node, key] });
  const dnsName = '0x' + name.split('.').map(l => {
    const b = Buffer.from(l); return b.length.toString(16).padStart(2,'0') + b.toString('hex');
  }).join('') + '00';
  const result = await client.readContract({
    address: RESOLVER, abi: resolveAbi, functionName: 'resolve', args: [dnsName, data],
  });
  const [value] = decodeAbiParameters([{ type: 'string' }], result);
  return value;
}

console.log('borrow.alice debtUSD       =', await resolveText('borrow.alice.seikine.eth', 'seikine:debtUSD'));
console.log('lend.alice   collateralUSD =', await resolveText('lend.alice.seikine.eth', 'seikine:collateralUSD'));
