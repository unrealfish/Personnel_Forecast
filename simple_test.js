// 简单测试记忆到知识图谱转换的核心功能

// 模拟必要的类和函数
class MemoryEntry {
  constructor({
    eventId,
    timestamp = Date.now(),
    content = '',
    emotion = '',
    importance = 0,
    participants = [],
    topic = '',
    round = 1,
    location = 'unknown'
  }) {
    this.id = `mem_${timestamp}_${Math.random().toString(16).slice(2, 6)}`;
    this.eventId = eventId;
    this.timestamp = timestamp;
    this.content = content;
    this.emotion = emotion;
    this.importance = importance;
    this.participants = participants;
    this.topic = topic;
    this.round = round;
    this.location = location;
    this.accessCount = 0;
    this.lastAccessed = timestamp;
  }
}

class MemorySummary {
  constructor({
    topic = '',
    startRound = 1,
    endRound = 1,
    content = '',
    relatedPeople = [],
    emotionTrend = '',
    importance = 0,
    location = 'unknown'
  }) {
    this.id = `summary_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    this.topic = topic;
    this.startRound = startRound;
    this.endRound = endRound;
    this.content = content;
    this.relatedPeople = relatedPeople;
    this.emotionTrend = emotionTrend;
    this.importance = importance;
    this.location = location;
    this.createdAt = Date.now();
  }
}

class AgentMemory {
  constructor(agentId, options = {}) {
    this.agentId = agentId;
    this.shortTermLimit = options.shortTermLimit || 8;
    this.midTermTrigger = options.midTermTrigger || 5;
    this.longTermInterval = options.longTermInterval || 10;

    this.shortTerm = [];
    this.midTerm = [];
    this.longTerm = [];
    this.personalityEvolution = [];

    this._topicIndex = new Map();
    this._personIndex = new Map();
  }

  addEvent(event, round) {
    const importance = this._calculateImportance(event);
    const entry = new MemoryEntry({
      eventId: event.id,
      timestamp: event.timestamp,
      content: event.action?.external_behavior || '',
      emotion: this._extractEmotion(event),
      importance,
      participants: this._extractParticipants(event),
      topic: event.payload?.goal || event.payload?.topic || '一般社交',
      round,
      location: event.location || 'unknown'
    });

    this.shortTerm.push(entry);
    this._indexEntry(entry);

    if (this.shortTerm.length > this.shortTermLimit) {
      const oldEntry = this.shortTerm.shift();
      this._promoteToMidTerm(oldEntry);
    }

    return entry;
  }

  _calculateImportance(event) {
    let score = 50;
    if (event.payload?.goal) score += 15;
    if (event.payload?.kgUpdates?.person_updates?.length > 0) score += 20;
    if (event.channel?.chat_scope === 'group') score += 10;
    if (event.receiver_ids?.length > 1) score += 10;
    return Math.min(100, score);
  }

  _extractEmotion(event) {
    const text = `${event.action?.internal_thought || ''} ${event.action?.external_behavior || ''}`;
    const positive = /开心|高兴|满意|喜欢|感谢|赞|好/.test(text);
    const negative = /生气|失望|担心|讨厌|愤怒|难过|差/.test(text);
    if (positive && !negative) return 'positive';
    if (negative && !positive) return 'negative';
    return 'neutral';
  }

  _extractParticipants(event) {
    const participants = new Set([event.initiator_id]);
    (event.receiver_ids || []).forEach(id => participants.add(id));
    return [...participants];
  }

  _indexEntry(entry) {
    if (entry.topic) {
      if (!this._topicIndex.has(entry.topic)) {
        this._topicIndex.set(entry.topic, []);
      }
      this._topicIndex.get(entry.topic).push(entry);
    }
    entry.participants.forEach(personId => {
      if (!this._personIndex.has(personId)) {
        this._personIndex.set(personId, []);
      }
      this._personIndex.get(personId).push(entry);
    });
  }

  _promoteToMidTerm(entry) {
    if (entry.importance >= 60) {
      this.midTerm.push(entry);
    }
  }

  generateSummary(round, llm) {
    if (this.shortTerm.length < this.midTermTrigger) return null;

    const topics = this._aggregateByTopic();
    const summaries = [];

    for (const [topic, entries] of topics) {
      if (entries.length >= 3) {
        const content = entries.map(e => e.content).join('\n');
        const relatedPeople = [...new Set(entries.flatMap(e => e.participants))];
        const emotions = entries.map(e => e.emotion);
        const emotionTrend = this._analyzeEmotionTrend(emotions);
        // 提取出现频率最高的地点
        const locationCounts = {};
        entries.forEach(e => {
          if (e.location && e.location !== 'unknown') {
            locationCounts[e.location] = (locationCounts[e.location] || 0) + 1;
          }
        });
        const mostFrequentLocation = Object.entries(locationCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

        const summary = new MemorySummary({
          topic,
          startRound: entries[0].round,
          endRound: entries[entries.length - 1].round,
          content: `关于"${topic}"的${entries.length}次互动：${content.substring(0, 200)}...`,
          relatedPeople,
          emotionTrend,
          importance: Math.max(...entries.map(e => e.importance)),
          location: mostFrequentLocation
        });

        summaries.push(summary);
      }
    }

    this.midTerm = [...this.midTerm, ...summaries];
    return summaries;
  }

  _aggregateByTopic() {
    const topics = new Map();
    for (const entry of this.shortTerm) {
      if (!topics.has(entry.topic)) {
        topics.set(entry.topic, []);
      }
      topics.get(entry.topic).push(entry);
    }
    return topics;
  }

  _analyzeEmotionTrend(emotions) {
    const counts = { positive: 0, negative: 0, neutral: 0 };
    emotions.forEach(e => counts[e]++);
    if (counts.positive > counts.negative) return 'positive';
    if (counts.negative > counts.positive) return 'negative';
    return 'neutral';
  }

  exportToGraphUpdates() {
    const updates = {
      new_nodes: [],
      new_links: [],
      person_updates: []
    };

    const existingMemoryNodes = new Set();

    for (const summary of this.midTerm) {
      const summaryNodeId = `memory_${this.agentId}_${summary.id}`;
      
      // 检查节点是否已存在
      if (!existingMemoryNodes.has(summaryNodeId)) {
        updates.new_nodes.push({
          id: summaryNodeId,
          name: `记忆：${summary.topic}`,
          type: '记忆片段',
          description: summary.content,
          importance: summary.importance,
          emotion: summary.emotionTrend
        });
        existingMemoryNodes.add(summaryNodeId);

        updates.new_links.push({
          source: this.agentId,
          target: summaryNodeId,
          relation: '记得'
        });

        for (const personId of summary.relatedPeople) {
          if (personId !== this.agentId) {
            updates.new_links.push({
              source: summaryNodeId,
              target: personId,
              relation: '关于'
            });
          }
        }

        // 添加地点关联
        if (summary.location && summary.location !== 'unknown') {
          updates.new_links.push({
            source: summaryNodeId,
            target: summary.location,
            relation: '发生在'
          });
        }
      }
    }

    if (this.personalityEvolution.length > 0) {
      const latest = this.personalityEvolution[this.personalityEvolution.length - 1];
      updates.person_updates.push({
        person_id: this.agentId,
        new_values: latest.changes.newValues || [],
        changed_values: latest.changes.changedValues || []
      });
    }

    return updates;
  }
}

// 测试代码
const memory = new AgentMemory('test_agent', { midTermTrigger: 3 });

// 创建测试事件
const event1 = {
  id: 'evt_1',
  timestamp: Date.now(),
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiator_id: 'test_agent',
  receiver_ids: ['other_agent'],
  location: 'Office',
  action: { externalBehavior: 'Hello, how are you?' },
  payload: { goal: 'Greeting' }
};

const event2 = {
  id: 'evt_2',
  timestamp: Date.now() + 1000,
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiator_id: 'other_agent',
  receiver_ids: ['test_agent'],
  location: 'Office',
  action: { externalBehavior: 'I\'m fine, thanks!' },
  payload: { goal: 'Greeting' }
};

const event3 = {
  id: 'evt_3',
  timestamp: Date.now() + 2000,
  channel: { onlineOffline: 'online', chatScope: 'private', specific: 'test' },
  initiator_id: 'test_agent',
  receiver_ids: ['other_agent'],
  location: 'Office',
  action: { externalBehavior: 'Great to hear!' },
  payload: { goal: 'Greeting' }
};

// 添加事件到记忆
memory.addEvent(event1, 1);
memory.addEvent(event2, 1);
memory.addEvent(event3, 1);

// 生成记忆摘要
memory.generateSummary(1);

// 导出到知识图谱更新
const updates = memory.exportToGraphUpdates();

console.log('Memory to Knowledge Graph Updates:');
console.log(JSON.stringify(updates, null, 2));
