(function(global) {
  const ChannelType = Object.freeze({
    PRIVATE_CHAT: 'private_chat',
    GROUP_CHAT: 'group_chat',
    FACE_TO_FACE: 'face_to_face',
    ONLINE_INTERACTION: 'online_interaction'
  });

  const PROFILE_RELATION_MAP = {
    '性格为': 'personality',
    '爱好是': 'hobbies',
    '属于星座': 'zodiac',
    '职业为': 'occupation',
    '最高学历为': 'education',
    '主修专业': 'major',
    '成长于': 'familyAtmosphere',
    '持有资产': 'asset',
    '持有观点': 'values',
    '渴求': 'coreNeed'
  };

  class AgentProfile {
    constructor({ id, name, personaText, personality = '', hobbies = '', mbti = '', metadata = {} }) {
      this.id = id;
      this.name = name;
      this.personaText = personaText || '';
      this.personality = personality;
      this.hobbies = hobbies;
      this.mbti = mbti;
      this.metadata = metadata;
    }
  }

  class AgentState {
    constructor({ emotionValue = 0, mentalActivity = '', context = {} } = {}) {
      this.emotionValue = emotionValue;
      this.mentalActivity = mentalActivity;
      this.context = context;
    }
  }

  class Action {
    constructor({ internalThought = '', externalBehavior = '' } = {}) {
      this.internal_thought = internalThought;
      this.external_behavior = externalBehavior;
    }
  }

  class InteractionEvent {
    constructor({
      channelType,
      initiatorId,
      receiverIds = [],
      location = 'unknown',
      timestamp = Date.now(),
      action = new Action(),
      payload = {},
      groupId = null
    }) {
      this.id = `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      this.channel_type = channelType;
      this.initiator_id = initiatorId;
      this.receiver_ids = receiverIds;
      this.location = location;
      this.timestamp = timestamp;
      this.action = action;
      this.payload = payload;
      this.group_id = groupId;
    }
  }

  class Agent {
    constructor({ profile, state = new AgentState() }) {
      this.profile = profile;
      this.state = state;
      this.currentLocation = 'unknown';
      this.groups = new Set();
      this._handlers = [];
    }

    setLocation(location) {
      this.currentLocation = location;
    }

    joinGroup(groupId) {
      this.groups.add(groupId);
    }

    onEvent(handler) {
      this._handlers.push(handler);
    }

    async receive(event, meta) {
      for (const handler of this._handlers) {
        await handler(event, meta, this);
      }
    }
  }

  class EventBus {
    constructor() {
      this.agents = new Map();
      this.groups = new Map();
      this.eventHistory = [];
    }

    registerAgent(agent) {
      this.agents.set(agent.profile.id, agent);
      for (const groupId of agent.groups) {
        this.subscribeGroup(groupId, agent.profile.id);
      }
    }

    subscribeGroup(groupId, agentId) {
      if (!this.groups.has(groupId)) {
        this.groups.set(groupId, new Set());
      }
      this.groups.get(groupId).add(agentId);
    }

    async publish(event) {
      this.eventHistory.push(event);
      const recipients = this.route(event);
      await Promise.all(
        [...recipients].map(async (agentId) => {
          const target = this.agents.get(agentId);
          if (!target) return;
          await target.receive(event, { visibleTo: recipients });
        })
      );
      return recipients;
    }

    route(event) {
      const recipients = new Set();
      switch (event.channel_type) {
        case ChannelType.PRIVATE_CHAT:
          event.receiver_ids.forEach((id) => recipients.add(id));
          break;
        case ChannelType.GROUP_CHAT: {
          const groupMembers = this.groups.get(event.group_id) || new Set();
          groupMembers.forEach((id) => recipients.add(id));
          break;
        }
        case ChannelType.FACE_TO_FACE:
          this.agents.forEach((agent) => {
            if (agent.currentLocation === event.location) {
              recipients.add(agent.profile.id);
            }
          });
          break;
        case ChannelType.ONLINE_INTERACTION:
          this.agents.forEach((_agent, id) => recipients.add(id));
          break;
        default:
          throw new Error(`Unknown channel_type: ${event.channel_type}`);
      }
      recipients.delete(event.initiator_id);
      return recipients;
    }
  }

  class SimulationEnvironment {
    constructor(eventBus, logger = console.log) {
      this.eventBus = eventBus;
      this.logger = logger;
      this.agents = new Map();
    }

    registerAgent(agent) {
      this.agents.set(agent.profile.id, agent);
      this.eventBus.registerAgent(agent);
      this.logger(`[Env] 注册 Agent: ${agent.profile.name}(${agent.profile.id})`);
    }

    async emit(event) {
      const recipients = await this.eventBus.publish(event);
      this.logger(`[Env] 事件已发布 ${event.channel_type} from=${event.initiator_id} to=[${[...recipients].join(', ')}]`);
      return recipients;
    }
  }

  function normalizeId(rawId) {
    return String(rawId);
  }

  function createGraphIndexes(graphData) {
    const nodes = graphData?.nodes || [];
    const links = graphData?.links || [];
    const nodeById = new Map(nodes.map((n) => [normalizeId(n.id), n]));

    const outLinks = new Map();
    links.forEach((l) => {
      const key = normalizeId(l.source);
      if (!outLinks.has(key)) outLinks.set(key, []);
      outLinks.get(key).push(l);
    });

    return { nodes, links, nodeById, outLinks };
  }

  function textList(items) {
    return [...new Set(items.filter(Boolean))].join('；');
  }

  function buildProfileFromGraph(personNode, indexes) {
    const pid = normalizeId(personNode.id);
    const attrs = {};
    const thoughtSeeds = [];

    (indexes.outLinks.get(pid) || []).forEach((link) => {
      const target = indexes.nodeById.get(normalizeId(link.target));
      if (!target) return;

      if (link.relation === '曾遭遇' || link.relation === '面临压力') {
        thoughtSeeds.push(target.name);
      }

      const mapKey = PROFILE_RELATION_MAP[link.relation];
      if (!mapKey) return;
      if (!attrs[mapKey]) attrs[mapKey] = [];
      attrs[mapKey].push(target.name);

      if (target.type === 'MBTI类型') {
        attrs.mbti = attrs.mbti || [];
        attrs.mbti.push(target.name);
      }
    });

    const metadata = {
      zodiac: textList(attrs.zodiac || []),
      occupation: textList(attrs.occupation || []),
      education: textList(attrs.education || []),
      major: textList(attrs.major || []),
      familyAtmosphere: textList(attrs.familyAtmosphere || []),
      asset: textList(attrs.asset || []),
      values: textList(attrs.values || []),
      coreNeed: textList(attrs.coreNeed || [])
    };

    const personaTextParts = [
      personNode.description,
      `职业: ${metadata.occupation}`,
      `价值观: ${metadata.values}`,
      `核心需求: ${metadata.coreNeed}`
    ].filter(Boolean);

    return {
      profile: new AgentProfile({
        id: pid,
        name: personNode.name,
        personaText: personaTextParts.join(' | '),
        personality: textList(attrs.personality || []),
        hobbies: textList(attrs.hobbies || []),
        mbti: textList(attrs.mbti || []),
        metadata
      }),
      state: new AgentState({
        emotionValue: 50,
        mentalActivity: textList(thoughtSeeds) || '保持观察',
        context: { graphNodeType: personNode.type }
      })
    };
  }

  function buildSimulationEvents(graphData, indexes) {
    const events = [];

    indexes.links.forEach((link) => {
      const source = indexes.nodeById.get(normalizeId(link.source));
      const target = indexes.nodeById.get(normalizeId(link.target));
      if (!source || !target) return;

      if (source.type === '人物' && target.type === '人物') {
        events.push(new InteractionEvent({
          channelType: ChannelType.PRIVATE_CHAT,
          initiatorId: normalizeId(source.id),
          receiverIds: [normalizeId(target.id)],
          action: new Action({
            internalThought: `${source.name}基于关系[${link.relation}]评估沟通策略`,
            externalBehavior: `就“${link.relation}”与${target.name}进行私聊。`
          }),
          payload: { relation: link.relation }
        }));
      }
    });

    const eventNodes = (graphData.nodes || []).filter((n) => n.type === '关系事件');
    eventNodes.forEach((eventNode) => {
      const eventId = normalizeId(eventNode.id);
      const participants = indexes.links
        .filter((l) => l.relation === '参与事件' && normalizeId(l.target) === eventId)
        .map((l) => indexes.nodeById.get(normalizeId(l.source)))
        .filter((n) => n && n.type === '人物');

      if (participants.length < 2) return;

      const locLink = indexes.links.find((l) => l.relation === '发生地' && normalizeId(l.source) === eventId);
      const locationNode = locLink ? indexes.nodeById.get(normalizeId(locLink.target)) : null;
      const location = locationNode?.name || 'unknown';

      const groupId = `event_group_${eventId}`;
      events.push(new InteractionEvent({
        channelType: ChannelType.GROUP_CHAT,
        initiatorId: normalizeId(participants[0].id),
        groupId,
        action: new Action({
          internalThought: `围绕事件[${eventNode.name}]同步多方观点`,
          externalBehavior: `在群组内讨论事件“${eventNode.name}”。`
        }),
        payload: { eventId, eventName: eventNode.name }
      }));

      events.push(new InteractionEvent({
        channelType: ChannelType.FACE_TO_FACE,
        initiatorId: normalizeId(participants[0].id),
        location,
        action: new Action({
          internalThought: `在地点[${location}]进行线下确认`,
          externalBehavior: `在${location}进行面对面沟通：${eventNode.name}。`
        }),
        payload: { eventId, eventName: eventNode.name, location }
      }));
    });

    return events;
  }

  async function enrichActionWithLLM(event, graphSummary, llm) {
    if (typeof llm !== 'function') return event;
    try {
      const prompt = `你是多智能体社交推演助手。请基于给定图谱摘要，为一次互动生成内藏与外显。
只返回JSON，格式：{"internal_thought":"...","external_behavior":"..."}

图谱摘要:${graphSummary}
渠道:${event.channel_type}
发起者:${event.initiator_id}
接收者:${event.receiver_ids.join(',')}
地点:${event.location}
当前预设行为:${event.action.external_behavior}`;
      const text = await llm(prompt);
      const jsonStr = text?.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) return event;
      const parsed = JSON.parse(jsonStr);
      if (parsed.internal_thought) event.action.internal_thought = parsed.internal_thought;
      if (parsed.external_behavior) event.action.external_behavior = parsed.external_behavior;
    } catch (_e) {
      // LLM增强失败时回退到图谱规则生成
    }
    return event;
  }

  async function runMultiAgentRoutingDemo(options = {}) {
    const logger = options.logger || ((msg) => console.log(msg));
    const graphData = options.graphData || { nodes: [], links: [] };
    const llm = options.llm;

    const indexes = createGraphIndexes(graphData);
    const personNodes = indexes.nodes.filter((n) => n.type === '人物');

    if (personNodes.length < 2) {
      logger('[Demo] 图谱中人物实体不足，至少需要2个人物。');
      return null;
    }

    const bus = new EventBus();
    const env = new SimulationEnvironment(bus, logger);

    const eventGroups = new Map();

    personNodes.forEach((personNode) => {
      const { profile, state } = buildProfileFromGraph(personNode, indexes);
      const agent = new Agent({ profile, state });

      indexes.links
        .filter((l) => l.relation === '参与事件' && normalizeId(l.source) === normalizeId(personNode.id))
        .forEach((l) => {
          const gid = `event_group_${normalizeId(l.target)}`;
          agent.joinGroup(gid);
          eventGroups.set(gid, true);
        });

      const face2faceLink = indexes.links.find(
        (l) => l.relation === '参与事件' && normalizeId(l.source) === normalizeId(personNode.id)
      );
      if (face2faceLink) {
        const locLink = indexes.links.find(
          (l) => l.relation === '发生地' && normalizeId(l.source) === normalizeId(face2faceLink.target)
        );
        const locationNode = locLink ? indexes.nodeById.get(normalizeId(locLink.target)) : null;
        if (locationNode) agent.setLocation(locationNode.name);
      }

      agent.onEvent(async (event) => {
        logger(`[Agent:${agent.profile.name}] 收到 ${event.channel_type} | 发起者=${event.initiator_id} | 外显=${event.action.external_behavior}`);
      });

      env.registerAgent(agent);
    });

    eventGroups.forEach((_v, gid) => {
      personNodes.forEach((p) => {
        const joined = indexes.links.some(
          (l) => l.relation === '参与事件' && normalizeId(l.source) === normalizeId(p.id) && gid === `event_group_${normalizeId(l.target)}`
        );
        if (joined) bus.subscribeGroup(gid, normalizeId(p.id));
      });
    });

    const events = buildSimulationEvents(graphData, indexes);
    if (events.length === 0) {
      logger('[Demo] 图谱中缺少可推演关系，未生成事件。');
      return { env, bus, events };
    }

    const graphSummary = JSON.stringify({
      people: personNodes.map((p) => p.name),
      relations: indexes.links.map((l) => ({ source: l.source, target: l.target, relation: l.relation }))
    });

    logger(`[Demo] 开始图谱驱动推演，共 ${events.length} 个事件。`);
    for (const event of events) {
      await enrichActionWithLLM(event, graphSummary, llm);
      await env.emit(event);
    }
    logger('[Demo] 图谱驱动推演完成。');

    return { env, bus, events };
  }

  global.MultiAgentSandbox = {
    ChannelType,
    AgentProfile,
    AgentState,
    Action,
    InteractionEvent,
    Agent,
    EventBus,
    SimulationEnvironment,
    runMultiAgentRoutingDemo
  };
  global.runMultiAgentRoutingDemo = runMultiAgentRoutingDemo;
})(window);
