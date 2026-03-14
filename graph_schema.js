(function (global) {
  const ENTITY_TYPES = [
    { name: '人物', description: '具体的人物个体（如：林薇、陈默、苏晴等）', group: '人物', color: '#ffcdd2' },
    { name: 'MBTI类型', description: '性格心理指标（如：INFP、ESTJ等）', group: '人物属性', color: '#b3e5fc' },
    { name: '星座', description: '占星分类（如：双鱼座、天蝎座）', group: '人物属性', color: '#b3e5fc' },
    { name: '职业', description: '具体的职位或行业（如：自由插画师、项目经理、大学教授等）', group: '人物属性', color: '#b3e5fc' },
    { name: '学历', description: '受教育水平（如：硕士、本科）', group: '人物属性', color: '#b3e5fc' },
    { name: '专业', description: '学习的领域（如：美术教育、土木工程）', group: '人物属性', color: '#b3e5fc' },
    { name: '家庭氛围', description: '对原生家庭环境的描述（如：高知开放、传统务实）', group: '人物属性', color: '#b3e5fc' },
    { name: '资产/财务', description: '具体的资产形式（如：存款、房产、贷款房）', group: '资产/财务', color: '#fff9c4' },
    { name: '价值观/观点', description: '包括消费观，金钱观，生育意愿等抽象态度', group: '内心', color: '#e1bee7' },
    { name: '压力与焦虑', description: '职业焦虑或工作压力源（如：AI替代、晋升瓶颈）', group: '内心', color: '#e1bee7' },
    { name: '休闲方式', description: '个人爱好与生活习惯（如：看展、打篮球）', group: '休闲方式', color: '#c8e6c9' },
    { name: '核心需求', description: '深层心理诉求（如：情感深度、安全感）', group: '内心', color: '#e1bee7' },
    { name: '地点', description: '涉及的地域（如：云南、老家）', group: '地点', color: '#d7ccc8' },
    { name: '关系事件', description: '交往过程中的关键节点（如：共同旅行、公益墙绘）', group: '关系事件', color: '#ffe0b2' },
    { name: '心理状态/创伤', description: '过往经历留下的心理印记（如：PUA经历、恐惧冲突）', group: '内心', color: '#e1bee7' },
    { name: '记忆片段', description: 'Agent的重要记忆摘要', group: '内心', color: '#d1c4e9' },
    { name: '其他', description: '未能归类的辅助信息', group: '其他', color: '#b2dfdb' }
  ];

  const RELATION_TYPES = [
    { name: '情侣', description: '人物 ↔ 人物', category: '社会关系', color: '#e91e63' },
    { name: '密友', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '父子', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '父女', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '母女', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '母子', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '兄弟', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '姐妹', description: '人物 → 人物', category: '社会关系', color: '#e91e63' },
    { name: '同事', description: '人物 ↔ 人物', category: '社会关系', color: '#e91e63' },
    { name: '熟人', description: '人物 ↔ 人物', category: '社会关系', color: '#e91e63' },
    { name: '朋友', description: '人物 ↔ 人物', category: '社会关系', color: '#e91e63' },
    { name: '亲戚', description: '人物 → 人物（如：表姐、舅舅）', category: '社会关系', color: '#e91e63' },
    { name: '夫妻', description: '人物 ↔ 人物', category: '社会关系', color: '#e91e63' },
    { name: '前任', description: '人物 → 人物/群体', category: '社会关系', color: '#e91e63' },
    { name: '性格为', description: '人物 → MBTI类型', category: '属性映射', color: '#2196f3' },
    { name: '属于星座', description: '人物 → 星座', category: '属性映射', color: '#2196f3' },
    { name: '职业为', description: '人物 → 职业', category: '属性映射', color: '#2196f3' },
    { name: '最高学历为', description: '人物 → 学历', category: '属性映射', color: '#2196f3' },
    { name: '主修专业', description: '人物 → 专业', category: '属性映射', color: '#2196f3' },
    { name: '成长于', description: '人物 → 家庭氛围', category: '属性映射', color: '#2196f3' },
    { name: '持有资产', description: '人物 → 资产/财务', category: '属性映射', color: '#2196f3' },
    { name: '持有观点', description: '人物 → 价值观/观点', category: '属性映射', color: '#2196f3' },
    { name: '面临压力', description: '人物 → 压力与焦虑', category: '属性映射', color: '#2196f3' },
    { name: '爱好是', description: '人物 → 休闲方式', category: '属性映射', color: '#2196f3' },
    { name: '渴求', description: '人物 → 核心需求', category: '属性映射', color: '#2196f3' },
    { name: '参与事件', description: '人物 → 关系事件', category: '事件行为', color: '#4caf50' },
    { name: '发生地', description: '关系事件 → 地点', category: '事件行为', color: '#4caf50' },
    { name: '曾遭遇', description: '人物 → 心理状态/创伤', category: '事件行为', color: '#4caf50' },
    { name: '关注/干预', description: '亲友 → 另一方/关系', category: '事件行为', color: '#4caf50' },
    { name: '推荐/建议', description: '密友 → 人物', category: '事件行为', color: '#4caf50' },
    { name: '记得', description: '人物 → 记忆片段', category: '记忆关系', color: '#9c27b0' },
    { name: '关于', description: '记忆片段 → 人物', category: '记忆关系', color: '#9c27b0' },
    { name: '发生在', description: '记忆片段 → 地点', category: '记忆关系', color: '#9c27b0' }
  ];

  const entityTypeDescriptions = ENTITY_TYPES
    .filter((item) => item.name !== '其他')
    .map((item) => `- ${item.name}：${item.description}`)
    .join('\n');

  const relationTypeDescriptions = RELATION_TYPES
    .map((item) => `- [${item.name}]：${item.description}`)
    .join('\n');

  function mapFrom(items, key, value) {
    return items.reduce((acc, item) => {
      acc[item[key]] = item[value];
      return acc;
    }, {});
  }

  const entityTypesText = ENTITY_TYPES.filter((item) => item.name !== '其他').map((item) => item.name).join('、');
  const relationTypesText = RELATION_TYPES.map((item) => item.name).join('、');

  global.KG_SCHEMA = Object.freeze({
    ENTITY_TYPES,
    RELATION_TYPES,
    entityTypeDescriptions,
    relationTypeDescriptions,
    entityTypesText,
    relationTypesText,
    typeColors: mapFrom(ENTITY_TYPES, 'name', 'color'),
    typeGroups: mapFrom(ENTITY_TYPES, 'name', 'group'),
    entityTypeColors: {
      人物: '#ffcdd2',
      人物属性: '#b3e5fc',
      '资产/财务': '#fff9c4',
      休闲方式: '#c8e6c9',
      内心: '#e1bee7',
      关系事件: '#ffe0b2',
      地点: '#d7ccc8',
      其他: '#b2dfdb'
    },
    relationColors: mapFrom(RELATION_TYPES, 'name', 'color')
  });
})(window);
