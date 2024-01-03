import chalk from 'chalk';
import { JsonRpcParamsSchemaByName, JsonRpcPayloadNotification, JsonRpcPayloadRequest } from 'json-rpc-protocol';
import readline from 'readline';
import WebSocket from 'ws';
import { jsonRpcInvoke, jsonRpcNotice, useClientLogger, useJsonRpcForWs } from './utils';

const help = `${chalk.bgGreen("usage:")}
invoke $method $params
  ${chalk.gray('equals to send {"id":x, "jsonrpc":"2.0", "method": $method, "params": $params}')}
notice $method $params
  ${chalk.gray('equals to send {"jsonrpc":"2.0", "method": $method, "params": $params}')}
`;
console.log(help);

const remoteUrl = 'ws://localhost:8080';
const ws = new WebSocket(remoteUrl);
useClientLogger(ws, { remoteUrl, localUrl: `` });
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const askQuestion = async function () {
  rl.question('', async (answer: string) => {
    try {
      const tokens = answer.split(' ').map(it => it.trim()).filter(it => it);
      const command = tokens[0];
      const method = tokens[1];
      const params = tokens[2] ? JSON.parse(tokens[2]) : undefined;
      switch (command) {
        case 'invoke':
          await jsonRpcInvoke(ws, method, params);
          break;
        case 'notice':
          jsonRpcNotice(ws, method, params);
          break;
        default:
          throw new Error(`unknown command ${command}`);
      }
    } catch (e) {
      console.error('invoke failed');
    }
    askQuestion();
  });
};
ws.on('open', async function open() {
  await jsonRpcInvoke(ws, 'introduce', { name: `cli@${process.pid}` });
  await jsonRpcInvoke(ws, 'registerMethod', { name: `greet` });
  await jsonRpcInvoke(ws, 'subscribe', { name: `hello` });
  askQuestion();
});
useJsonRpcForWs(ws, {
  methods: {
    greet: function (this: WebSocket, rpc: JsonRpcPayloadRequest) {
      const { name } = rpc.params as JsonRpcParamsSchemaByName;
      return `hello ${name}`;
    }
  },
  subscriptions: {
    hello: function (this: WebSocket, rpc: JsonRpcPayloadNotification) {
      const { name } = rpc.params as JsonRpcParamsSchemaByName;
      console.log(`hello ${name}`);
    }
  }
});