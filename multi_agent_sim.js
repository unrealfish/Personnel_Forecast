(function(global) {
  const ChannelMode = Object.freeze({
    ONLINE: 'online',
    OFFLINE: 'offline',
    PRIVATE: 'private',
    GROUP: 'group'
  });

  function normalizeChannel(raw = {}) {
    const onlineOffline = raw.online_offline || raw.onlineOffline || ChannelMode.ONLINE;
    const chatScope = raw.chat_scope || raw.chatScope || ChannelMode.PRIVATE;
    const specific = raw.specific || raw.detail || '未指定';
    return { online_offline: onlineOffline, chat_scope: chatScope, specific };
  }

  function deriveLegacyChannelType(channel) {
    if (channel.chat_scope === ChannelMode.GROUP) {
      return channel.online_offline === ChannelMode.OFFLINE ? 'offline_group' : 'online_group';
    }
    return channel.online_offline === ChannelMode.OFFLINE ? 'offline_private' : 'online_private';
  }

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
      channel,
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
      this.channel = normalizeChannel(channel || (channelType ? {
        onlineOffline: channelType === 'face_to_face' ? ChannelMode.OFFLINE : ChannelMode.ONLINE,
        chatScope: channelType === 'group_chat' ? ChannelMode.GROUP : ChannelMode.PRIVATE,
        specific: channelType
      } : {}));
      this.channel_type = deriveLegacyChannelType(this.channel);
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

    async handleEvent(event, context = {}) {
      const { llm, indexes, graphSummary = '{}', memoryWindow = 8 } = context;
      if (event.initiator_id === this.profile.id || typeof llm !== 'function') return null;

      const initiator = indexes?.nodeById?.get(normalizeId(event.initiator_id));
      const receiverNames = (event.receiver_ids || [])
        .map((id) => indexes?.nodeById?.get(normalizeId(id))?.name || id)
        .join('、') || '群组成员';
      const memory = (context.eventHistory || [])
        .slice(-Math.max(1, memoryWindow))
        .map((item) => {
          const speaker = indexes?.nodeById?.get(normalizeId(item.initiator_id))?.name || item.initiator_id;
          return `${speaker}: ${item.action?.external_behavior || ''}`;
        })
        .join('\n');

      const prompt = `你正在参与一个多智能体社会推演。你当前扮演角色【${this.profile.name}】。
角色设定：${this.profile.personaText}
人格特征：${this.profile.personality || '未提供'}；MBTI：${this.profile.mbti || '未知'}；核心需求：${this.profile.metadata?.coreNeed || '未提供'}。

【全局背景摘要】\n${graphSummary}
【近期记忆】\n${memory || '暂无'}
【当前收到事件】
发起人：${initiator?.name || event.initiator_id}
接收方：${receiverNames}
渠道：${event.channel.online_offline}/${event.channel.chat_scope}/${event.channel.specific}
内容：${event.action?.external_behavior || '无'}

请判断你是否需要回应。若决定无视或保持沉默，请将reply_behavior严格填为"无"（不要留空或其他词）。
严格返回JSON对象，不要使用markdown代码块：
{"internal_thought":"...","reply_behavior":"...","channel_specific":"...","kg_updates":{"new_nodes":[],"new_links":[],"person_updates":[]}}`;

      const parsed = safeParseJsonObject(await llm(prompt));
      const replyText = parsed?.reply_behavior?.trim();
      const ignoreWords = new Set(['', '无', 'null', '不回应', '沉默', '保持沉默']);
      const normalizedReply = (replyText || '').toLowerCase();
      if (!replyText || ignoreWords.has(normalizedReply)) return null;

      return new InteractionEvent({
        channel: {
          onlineOffline: event.channel.online_offline,
          chatScope: ChannelMode.PRIVATE,
          specific: parsed.channel_specific || `回应:${event.channel.specific}`
        },
        initiatorId: this.profile.id,
        receiverIds: [event.initiator_id],
        location: event.location,
        action: new Action({
          internalThought: parsed.internal_thought || `${this.profile.name}选择回应`,
          externalBehavior: replyText
        }),
        payload: {
          ...(parsed.kg_updates ? { kgUpdates: parsed.kg_updates } : {}),
          reactionTo: event.id,
          generatedBy: 'agent_reaction'
        }
      });
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
      switch (event.channel.chat_scope) {
        case ChannelMode.PRIVATE:
          event.receiver_ids.forEach((id) => recipients.add(id));
          break;
        case ChannelMode.GROUP: {
          const groupMembers = this.groups.get(event.group_id) || new Set();
          if (groupMembers.size > 0) {
            groupMembers.forEach((id) => recipients.add(id));
          } else if (event.channel.online_offline === ChannelMode.OFFLINE) {
            this.agents.forEach((agent) => {
              if (agent.currentLocation === event.location) {
                recipients.add(agent.profile.id);
              }
            });
          } else {
            this.agents.forEach((_agent, id) => recipients.add(id));
          }
          break;
        }
        default:
          throw new Error(`Unknown chat_scope: ${event.channel.chat_scope}`);
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
      this.logger(`[Env] 事件已发布 channel={${event.channel.online_offline}/${event.channel.chat_scope}/${event.channel.specific}} from=${event.initiator_id} to=[${[...recipients].join(', ')}]`);
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
          channel: { onlineOffline: ChannelMode.ONLINE, chatScope: ChannelMode.PRIVATE, specific: '即时文字私聊' },
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
        channel: { onlineOffline: ChannelMode.ONLINE, chatScope: ChannelMode.GROUP, specific: '事件群组同步' },
        initiatorId: normalizeId(participants[0].id),
        groupId,
        action: new Action({
          internalThought: `围绕事件[${eventNode.name}]同步多方观点`,
          externalBehavior: `在群组内讨论事件“${eventNode.name}”。`
        }),
        payload: { eventId, eventName: eventNode.name }
      }));

      events.push(new InteractionEvent({
        channel: { onlineOffline: ChannelMode.OFFLINE, chatScope: ChannelMode.GROUP, specific: '线下会面沟通' },
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

  function buildCustomEvents(customEvents = [], personNodes = []) {
    if (!Array.isArray(customEvents) || customEvents.length === 0 || personNodes.length < 2) return [];
    const sorted = [...customEvents].sort((a, b) => (a.time || 1) - (b.time || 1));
    return sorted.map((evt, idx) => {
      const initiator = personNodes[idx % personNodes.length];
      const receiver = personNodes[(idx + 1) % personNodes.length];
      return new InteractionEvent({
        channel: { onlineOffline: ChannelMode.ONLINE, chatScope: ChannelMode.PRIVATE, specific: '待LLM补全具体渠道' },
        initiatorId: normalizeId(initiator.id),
        receiverIds: [normalizeId(receiver.id)],
        action: new Action({
          internalThought: `${initiator.name}围绕用户注入事件进行判断`,
          externalBehavior: `在第${evt.time}轮触发事件：${evt.text}`
        }),
        payload: { injectedEvent: evt.text, round: evt.time }
      });
    });
  }

  function upsertNode(nextGraph, nodeLike) {
    const existing = nextGraph.nodes.find((n) => normalizeId(n.id) === normalizeId(nodeLike.id));
    if (existing) {
      Object.assign(existing, nodeLike);
      return existing;
    }
    nextGraph.nodes.push(nodeLike);
    return nodeLike;
  }

  function ensureNodeByName(nextGraph, name, type = '其他', description = '') {
    const found = nextGraph.nodes.find((n) => n.name === name);
    if (found) return found;
    const id = `sim_node_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
    const node = { id, name, type, description };
    nextGraph.nodes.push(node);
    return node;
  }

  function upsertLink(nextGraph, linkLike) {
    const exists = nextGraph.links.some(
      (l) => normalizeId(l.source) === normalizeId(linkLike.source)
        && normalizeId(l.target) === normalizeId(linkLike.target)
        && l.relation === linkLike.relation
    );
    if (!exists) nextGraph.links.push(linkLike);
  }

  function applyKnowledgeGraphUpdates(nextGraph, kgUpdates = {}, indexes) {
    const personByName = new Map((nextGraph.nodes || []).filter((n) => n.type === '人物').map((n) => [n.name, n]));
    (kgUpdates.new_nodes || []).forEach((node) => {
      if (!node?.name) return;
      ensureNodeByName(nextGraph, node.name, node.type || '其他', node.description || '推演新增实体');
    });

    (kgUpdates.new_links || []).forEach((link) => {
      if (!link?.source || !link?.target || !link?.relation) return;
      const sourceNode = indexes.nodeById.get(normalizeId(link.source)) || personByName.get(link.source) || ensureNodeByName(nextGraph, link.source);
      const targetNode = indexes.nodeById.get(normalizeId(link.target)) || personByName.get(link.target) || ensureNodeByName(nextGraph, link.target);
      upsertLink(nextGraph, { source: sourceNode.id, target: targetNode.id, relation: link.relation });
    });

    (kgUpdates.person_updates || []).forEach((item) => {
      const person = indexes.nodeById.get(normalizeId(item.person_id)) || personByName.get(item.person_name);
      if (!person) return;
      const appendTraits = (arr, relation, type = '价值观/观点') => {
        (arr || []).forEach((text) => {
          if (!text) return;
          const traitNode = ensureNodeByName(nextGraph, text, type, '推演阶段新增');
          upsertLink(nextGraph, { source: person.id, target: traitNode.id, relation });
        });
      };
      appendTraits(item.new_skills, '习得技能', '其他');
      appendTraits(item.new_knowledge, '掌握知识', '其他');
      appendTraits(item.new_values, '持有观点', '价值观/观点');
      (item.changed_values || []).forEach((change) => {
        if (!change?.to) return;
        const valueNode = ensureNodeByName(nextGraph, change.to, '价值观/观点', change.reason || '推演中的观念变化');
        upsertLink(nextGraph, { source: person.id, target: valueNode.id, relation: '观念转变为' });
      });
    });
  }

  function updateGraphWithRoundFeedback(graphData, round, roundEvents = [], indexes) {
    const nextGraph = {
      nodes: [...(graphData.nodes || [])],
      links: [...(graphData.links || [])]
    };
    roundEvents.forEach((event, idx) => {
      if (!event) return;
      const hasKgUpdates = Boolean(event.payload?.kgUpdates);
      if (hasKgUpdates) {
        const eventNodeId = `sim_round_${round}_event_${idx + 1}`;
        const eventNodeName = event.payload?.eventName
          || `第${round}轮事件${idx + 1}`;
        const detail = `${event.action?.external_behavior || ''}；渠道=${event.channel.online_offline}/${event.channel.chat_scope}/${event.channel.specific}`;
        upsertNode(nextGraph, {
          id: eventNodeId,
          name: eventNodeName,
          type: '关系事件',
          description: detail
        });
        upsertLink(nextGraph, { source: event.initiator_id, target: eventNodeId, relation: '发起事件' });
        (event.receiver_ids || []).forEach((rid) => {
          upsertLink(nextGraph, { source: rid, target: eventNodeId, relation: '参与事件' });
        });
        if (event.location && event.location !== 'unknown') {
          const locationNode = ensureNodeByName(nextGraph, event.location, '地点', '推演触发地点');
          upsertLink(nextGraph, { source: eventNodeId, target: locationNode.id, relation: '发生地' });
        }
        applyKnowledgeGraphUpdates(nextGraph, event.payload.kgUpdates, indexes);
      }
    });
    return nextGraph;
  }

  function safeParseJsonObject(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();

    const start = cleaned.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = cleaned.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch (_e) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function buildGraphSummary(indexes) {
    return JSON.stringify({
      people: indexes.nodes.filter((n) => n.type === '人物').map((p) => ({ id: p.id, name: p.name })),
      relations: indexes.links.map((l) => ({
        source: indexes.nodeById.get(normalizeId(l.source))?.name || l.source,
        target: indexes.nodeById.get(normalizeId(l.target))?.name || l.target,
        relation: l.relation
      }))
    });
  }

  function getEventSignature(event) {
    return [
      event.initiator_id,
      [...(event.receiver_ids || [])].sort().join(','),
      event.channel.online_offline,
      event.channel.chat_scope,
      event.channel.specific,
      event.payload?.relation || '',
      event.payload?.eventId || '',
      event.payload?.injectedEvent || ''
    ].join('|');
  }

  async function enrichActionWithLLM(event, graphSummary, llm, indexes) {
    if (typeof llm !== 'function') return event;
    try {
      const initiatorName = indexes?.nodeById?.get(normalizeId(event.initiator_id))?.name || event.initiator_id;
      const receiverNames = (event.receiver_ids || []).map((id) => indexes?.nodeById?.get(normalizeId(id))?.name || id);
      const prompt = `你是多智能体社交推演助手。请基于给定图谱摘要，为一次互动生成内藏与外显。
只返回JSON，格式：{"internal_thought":"...","external_behavior":"...","channel_specific":"...","kg_updates":{"new_nodes":[],"new_links":[],"person_updates":[]}}

图谱摘要:${graphSummary}
渠道维度:${event.channel.online_offline}/${event.channel.chat_scope}
渠道具体:${event.channel.specific}
发起者:${initiatorName}
接收者:${receiverNames.join(',')}
地点:${event.location}
当前预设行为:${event.action.external_behavior}`;
      const parsed = safeParseJsonObject(await llm(prompt));
      if (!parsed) return event;
      if (parsed.internal_thought) event.action.internal_thought = parsed.internal_thought;
      if (parsed.external_behavior) event.action.external_behavior = parsed.external_behavior;
      if (parsed.channel_specific) event.channel.specific = parsed.channel_specific;
      if (parsed.kg_updates && typeof parsed.kg_updates === 'object') {
        event.payload = { ...(event.payload || {}), kgUpdates: parsed.kg_updates };
      }
    } catch (_e) {
      // LLM增强失败时回退到图谱规则生成
    }
    return event;
  }

  async function runMultiAgentRoutingDemo(options = {}) {
    const logger = options.logger || ((msg) => console.log(msg));
    const graphData = options.graphData || { nodes: [], links: [] };
    const llm = options.llm;
    const rounds = Math.max(1, Number(options.rounds) || 1);
    const customEvents = Array.isArray(options.customEvents) ? options.customEvents : [];
    const onRoundComplete = typeof options.onRoundComplete === 'function' ? options.onRoundComplete : null;
    const maxEventsPerRound = Math.max(1, Number(options.maxEventsPerRound) || 64);
    const maxReactionDepth = Math.max(0, Number(options.maxReactionDepth) || 3);

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
        logger(`[Agent:${agent.profile.name}] 收到 ${event.channel.online_offline}/${event.channel.chat_scope}/${event.channel.specific} | 发起者=${event.initiator_id} | 外显=${event.action.external_behavior}`);
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

    const events = [];
    if (events.length === 0) {
      logger('[Demo] 将按轮次动态构建事件队列（含Agent自主反应）。');
    }

    let mutableGraph = graphData;
    const executedSeedEventSignatures = new Set();
    logger(`[Demo] 推演任务开始：共 ${rounds} 轮，每轮最多 ${maxEventsPerRound} 个事件。`);
    for (let round = 1; round <= rounds; round += 1) {
      const currentIndexes = createGraphIndexes(mutableGraph);
      const currentPeople = currentIndexes.nodes.filter((n) => n.type === '人物');
      const graphSummary = buildGraphSummary(currentIndexes);

      const baseEvents = buildSimulationEvents(mutableGraph, currentIndexes)
        .filter((event) => {
          const sig = getEventSignature(event);
          return !executedSeedEventSignatures.has(sig);
        });
      const injectedEvents = buildCustomEvents(customEvents, currentPeople)
        .filter((event) => Number(event.payload?.round || round) === round);
      const queue = [...baseEvents, ...injectedEvents]
        .map((event) => ({ event, depth: 0 }));

      logger(`[Demo] ===== 第 ${round} 轮开始 =====`);
      const roundEvents = [];
      while (queue.length > 0 && roundEvents.length < maxEventsPerRound) {
        const item = queue.shift();
        const event = item.event;
        const seedSignature = getEventSignature(event);
        if (!event.payload?.generatedBy) {
          executedSeedEventSignatures.add(seedSignature);
          await enrichActionWithLLM(event, graphSummary, llm, currentIndexes);
        }
        const recipients = await env.emit(event);
        roundEvents.push(event);

        if (item.depth >= maxReactionDepth) continue;
        for (const recipientId of recipients) {
          const recipientAgent = env.agents.get(recipientId);
          if (!recipientAgent) continue;
          const reaction = await recipientAgent.handleEvent(event, {
            llm,
            indexes: currentIndexes,
            graphSummary,
            eventHistory: bus.eventHistory
          });
          if (reaction) {
            queue.push({ event: reaction, depth: item.depth + 1 });
          }
        }
      }
      mutableGraph = updateGraphWithRoundFeedback(mutableGraph, round, roundEvents, currentIndexes);
      logger(`[Demo] ===== 第 ${round} 轮完成：执行 ${roundEvents.length} 个事件，累计 ${bus.eventHistory.length} 条历史 =====`);
      if (onRoundComplete) {
        await onRoundComplete({
          round,
          graphData: mutableGraph,
          historySize: bus.eventHistory.length,
          roundEvents
        });
      }
    }
    logger('[Demo] 推演任务完成。');

    return { env, bus, events: bus.eventHistory, graphData: mutableGraph };
  }

  global.MultiAgentSandbox = {
    ChannelMode,
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
