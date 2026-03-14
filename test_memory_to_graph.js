// 测试记忆到知识图谱转换
const fs = require('fs');
const path = require('path');

// 读取文件内容
const multiAgentCode = fs.readFileSync(path.join(__dirname, 'multi_agent_sim.js'), 'utf8');
const graphSchemaCode = fs.readFileSync(path.join(__dirname, 'graph_schema.js'), 'utf8');

// 创建沙箱环境
const sandbox = {
  console: console,
  Date: Date,
  Math: Math
};

// 模拟浏览器环境
const vm = require('vm');
vm.createContext(sandbox);

// 执行 graph_schema.js - 修改 global 引用
const modifiedGraphSchemaCode = graphSchemaCode.replace(/\(global\)/g, '(sandbox)').replace(/global\./g, 'sandbox.');
vm.runInContext(modifiedGraphSchemaCode, sandbox);

// 执行 multi_agent_sim.js - 修改 window 引用
const modifiedMultiAgentCode = multiAgentCode.replace(/\(window\)/g, '(sandbox)').replace(/global\./g, 'sandbox.');
vm.runInContext(modifiedMultiAgentCode, sandbox);

// 获取类
const Agent = sandbox.MultiAgentSandbox.Agent;
const AgentProfile = sandbox.MultiAgentSandbox.AgentProfile;
const InteractionEvent = sandbox.MultiAgentSandbox.InteractionEvent;
const Action = sandbox.MultiAgentSandbox.Action;

// 创建测试 Agent
const profile = new AgentProfile({
  id: 'test_agent',
  name: 'Test Agent',
  personaText: 'A test agent',
  personality: 'Friendly'
});

const agent = new Agent({ profile });

// 创建测试事件
const event1 = new InteractionEvent({
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiatorId: 'test_agent',
  receiverIds: ['other_agent'],
  location: 'Office',
  action: new Action({ externalBehavior: 'Hello, how are you?' }),
  payload: { goal: 'Greeting' }
});

const event2 = new InteractionEvent({
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiatorId: 'other_agent',
  receiverIds: ['test_agent'],
  location: 'Office',
  action: new Action({ externalBehavior: 'I\'m fine, thanks!' }),
  payload: { goal: 'Greeting' }
});

const event3 = new InteractionEvent({
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiatorId: 'test_agent',
  receiverIds: ['other_agent'],
  location: 'Office',
  action: new Action({ externalBehavior: 'Great to hear!' }),
  payload: { goal: 'Greeting' }
});

// 接收事件
agent.receive(event1, {}, 1);
agent.receive(event2, {}, 1);
agent.receive(event3, {}, 1);

// 生成记忆摘要
agent.memory.generateSummary(1);

// 导出到知识图谱更新
const updates = agent.memory.exportToGraphUpdates();

console.log('Memory to Knowledge Graph Updates:');
console.log(JSON.stringify(updates, null, 2));
