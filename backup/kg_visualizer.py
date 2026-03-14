#!/usr/bin/env python3
"""
🌐 本地知识图谱可视化工具
输入文本 -> 自动抽取实体和关系 -> 浏览器可视化

使用方法:
    streamlit run kg_visualizer.py
"""

import streamlit as st
import networkx as nx
from pyvis.network import Network
import re
import json
from pathlib import Path

# ============ 实体抽取模块 ============

# 常见实体模式
ENTITY_PATTERNS = {
    "PERSON": [
        r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b',  # 人名
    ],
    "ORG": [
        r'\b([A-Z][a-zA-Z]+(?:\s+(?:Inc|Corp|Ltd|Company|Co\.|Group|Technologies|University|Institute)))\b',  # 公司/组织
    ],
    "PRODUCT": [
        r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Pro|Max|Plus|Lite|XS|Ultra|Plus))?)\b',  # 产品名
    ],
    "LOCATION": [
        r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:City|Country|University|State|County)))\b',  # 地名
    ],
}

# 关系模式
RELATION_PATTERNS = [
    (r'(\w+)\s+(is\s+|are\s+|was\s+|were\s+)(the\s+)?(\w+)\s+of\s+(\w+)', 'is_a'),
    (r'(\w+)\s+(works?\s+at|employed\s+at|employed\s+by)\s+(\w+)', 'works_at'),
    (r'(\w+)\s+(founded|created|built|developed)\s+(\w+)', 'founded'),
    (r'(\w+)\s+(is\s+the\s+CEO|is\s+the\s+president|is\s+the\s+founder)\s+of\s+(\w+)', 'CEO_of'),
    (r'(\w+)\s+(makes?|produces?|sells?)\s+(\w+)', 'makes'),
    (r'(\w+)\s+(is\s+located\s+in|based\s+in)\s+(\w+)', 'located_in'),
    (r'(\w+)\s+(partnered\s+with|collaborates?\s+with)\s+(\w+)', 'partnered_with'),
    (r'(\w+)\s+(acquired|bought|purchased)\s+(\w+)', 'acquired'),
    (r'(\w+)\s+(related\s+to|connected\s+to|linked\s+to)\s+(\w+)', 'related_to'),
]

def extract_entities(text):
    """抽取实体"""
    entities = {}
    
    # 使用正则抽取实体
    for entity_type, patterns in ENTITY_PATTERNS.items():
        for pattern in patterns:
            matches = re.findall(pattern, text)
            for match in matches:
                if isinstance(match, tuple):
                    name = match[0]
                else:
                    name = match
                name = name.strip()
                if len(name) > 2:
                    entities[name] = entity_type
    
    return entities

def extract_relations(text, entities):
    """抽取关系"""
    relations = []
    entity_names = list(entities.keys())
    
    # 实体名按长度排序，优先匹配更长的名称
    entity_names.sort(key=len, reverse=True)
    
    for pattern, rel_type in RELATION_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                for i, part in enumerate(match):
                    part = part.strip()
                    # 检查是否是已知实体
                    for ent_name in entity_names:
                        if ent_name.lower() in part.lower():
                            if i == 0:
                                source = ent_name
                            elif i == len(match) - 1:
                                target = ent_name
                
                # 如果找到了源和目标
                if len(match) >= 3:
                    source = match[0].strip()
                    target = match[-1].strip()
                    
                    # 映射到实体
                    for ent_name in entity_names:
                        if ent_name.lower() == source.lower():
                            source = ent_name
                        if ent_name.lower() == target.lower():
                            target = ent_name
                    
                    if source != target and entities.get(source) and entities.get(target):
                        relations.append((source, rel_type, target))
    
    return relations

def simple_extract(text):
    """简化抽取：基于关键词规则 - 支持中英文"""
    entities = {}
    relations = []
    
    # ============ 中文支持 ============
    # 检测是否为中文文本
    has_chinese = bool(re.search(r'[\u4e00-\u9fff]', text))
    
    if has_chinese:
        # 中文实体关键词
        person_kw = ['CEO', '首席执行官', '总裁', '董事长', '创始人', '创立者', '老板', '负责人']
        org_kw = ['公司', '集团', '企业', '机构', '大学', '研究所', '组织']
        product_kw = ['产品', '软件', '应用', '平台', '系统', '服务', '手机', '电脑', '汽车']
        
        # 中文关系模式
        cn_relation_patterns = [
            (r'([^\s，。、！？]{2,6})(?:是|担任|作为)(?:.*?)的?([CEO]|首席执行官|总裁|董事长|创始人|创立者)', 'is_CEO'),
            (r'([^\s，。、！？]{2,6})(?:创立|创建|成立|创办|建立)(?:于)?(?:.*?)(?:的?公司)?', 'founded'),
            (r'([^\s，。、！？]{2,6})(?:生产|制造|开发|设计)(?:.*?)(?:产品|软件|手机|电脑|汽车)', 'makes'),
            (r'([^\s，。、！？]{2,6})(?:收购|并购)(?:了)?([^\s，。、！？]{2,6})', 'acquired'),
            (r'([^\s，。、！？]{2,6})(?:是|位于|总部在)([^\s，。、！？]{2,6})', 'is_in'),
        ]
        
        # 分句
        sentences = re.split(r'[。！？\n]+', text)
        
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            
            # 抽取中文实体 - 基于常见模式
            # 模式1: "X是Y的CEO/创始人"
            for pattern, rel_type in cn_relation_patterns:
                matches = re.findall(pattern, sent)
                for match in matches:
                    if isinstance(match, tuple):
                        for part in match:
                            if len(part) >= 2:
                                # 分类
                                if any(kw in part for kw in person_kw):
                                    entities[part] = 'PERSON'
                                elif any(kw in part for kw in org_kw):
                                    entities[part] = 'ORG'
                                elif any(kw in part for kw in product_kw):
                                    entities[part] = 'PRODUCT'
                                else:
                                    entities[part] = 'ENTITY'
                    
                    # 提取关系
                    if rel_type == 'is_CEO':
                        # 匹配 "X是CEO" 或 "X担任CEO"
                        ceo_match = re.search(r'([^\s，。、！？]{2,6})(?:是|担任|作为)(?:.*?)([CEO]|首席执行官|总裁)', sent)
                        if ceo_match:
                            person, title = ceo_match.groups()
                            # 寻找公司名
                            company_match = re.search(r'(?:of|在|的|于)([^\s，。、！？]{2,6})(?:公司|集团|企业)', sent)
                            if company_match:
                                company = company_match.group(1) + '公司'
                                entities[person] = 'PERSON'
                                entities[company] = 'ORG'
                                relations.append((person, 'is_CEO_of', company))
            
            # 模式2: "X创立了Y公司"
            founded_match = re.search(r'([^\s，。、！？]{2,6})(?:创立|创建|成立|创办)(?:了|的)?([^\s，。、！？]{2,6})(?:公司|集团|企业)', sent)
            if founded_match:
                person, company = founded_match.groups()
                company = company + '公司'
                entities[person] = 'PERSON'
                entities[company] = 'ORG'
                relations.append((person, 'founded', company))
            
            # 模式3: "X收购了Y"
            acquired_match = re.search(r'([^\s，。、！？]{2,6})(?:收购|并购)(?:了)?([^\s，。、！？]{2,6})', sent)
            if acquired_match:
                source, target = acquired_match.groups()
                entities[source] = 'ORG'
                entities[target] = 'ORG'
                relations.append((source, 'acquired', target))
        
        # 尝试提取更多中文实体
        # 提取所有2-6个连续中文字符作为潜在实体
        potential_entities = re.findall(r'[\u4e00-\u9fff]{2,6}', text)
        for ent in potential_entities:
            ent_lower = ent.lower()
            if any(kw in ent_lower for kw in person_kw):
                entities[ent] = 'PERSON'
            elif any(kw in ent_lower for kw in org_kw):
                entities[ent] = 'ORG'
            elif any(kw in ent_lower for kw in product_kw):
                entities[ent] = 'PRODUCT'
            elif ent not in ['公司', '集团', '企业', '创始人', '创立者', '首席执行官', '总裁', '董事长', 'CEO', '收购', '并购', '生产', '制造']:
                # 过滤掉常见词
                if len(ent) >= 2:
                    entities[ent] = 'ENTITY'
        
        return entities, relations
    
    # ============ 英文支持（原有逻辑）===========
    # 定义一些常见实体关键词
    person_kw = ['CEO', 'founder', 'president', 'founder', 'developer', 'scientist', 'engineer', 'author', 'writer']
    org_kw = ['company', 'corp', 'inc', 'ltd', 'university', 'institute', 'organization', 'startup']
    product_kw = ['product', 'software', 'app', 'platform', 'system', 'service']
    
    # 分句
    sentences = re.split(r'[.!?\n]+', text)
    
    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
            
        words = sent.split()
        
        # 寻找实体（连续的大写字母开头的词）
        potential_entities = []
        i = 0
        while i < len(words):
            word = words[i].strip(',;:')
            if word and word[0].isupper() and len(word) > 1:
                # 尝试获取多词实体
                entity = word
                j = i + 1
                while j < len(words) and words[j][0].isupper():
                    entity += ' ' + words[j]
                    j += 1
                potential_entities.append((entity, i))
                i = j
            else:
                i += 1
        
        # 为潜在实体分类
        for ent, idx in potential_entities:
            ent_lower = ent.lower()
            if any(kw in ent_lower for kw in person_kw):
                entities[ent] = 'PERSON'
            elif any(kw in ent_lower for kw in org_kw):
                entities[ent] = 'ORG'
            elif any(kw in ent_lower for kw in product_kw):
                entities[ent] = 'PRODUCT'
            elif len(ent.split()) <= 3:  # 假设短的是实体
                # 默认归类
                entities[ent] = 'ENTITY'
        
        # 抽取关系
        for rel_type in ['CEO of', 'founder of', 'works at', 'based in', 'makes', 'acquired']:
            if rel_type in sent.lower():
                parts = sent.lower().split(rel_type)
                if len(parts) == 2:
                    source = parts[0].strip().split()[-1].title()
                    target = parts[1].strip().split()[0].title()
                    
                    if source in entities and target in entities:
                        relations.append((source, rel_type.replace(' ', '_'), target))
    
    return entities, relations

def build_graph(text, use_simple=True):
    """构建知识图谱"""
    if use_simple:
        entities, relations = simple_extract(text)
    else:
        entities = extract_entities(text)
        relations = extract_relations(text, entities)
    
    # 如果简单方法没抽到关系，用更宽松的规则
    if not relations:
        sentences = re.split(r'[.!?\n]+', text)
        for sent in sentences:
            sent = sent.strip()
            # 寻找 "X is Y" 模式
            match = re.search(r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+(a\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', sent)
            if match:
                source, target = match.group(1), match.group(3)
                if source in entities and target in entities:
                    relations.append((source, 'is_a', target))
            
            # 寻找 "X from Y" 模式
            match = re.search(r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', sent)
            if match:
                source, target = match.group(1), match.group(2)
                if source in entities and target in entities:
                    relations.append((source, 'from', target))
    
    return entities, relations

# ============ 可视化模块 ============

def create_pyvis_graph(entities, relations):
    """创建 pyvis 网络图"""
    net = Network(height="600px", width="100%", bgcolor="#222222", font_color="white")
    net.force_atlas_2based()
    
    # 颜色映射
    colors = {
        'PERSON': '#ff6b6b',
        'ORG': '#4ecdc4',
        'PRODUCT': '#ffe66d',
        'LOCATION': '#95e1d3',
        'ENTITY': '#dfe6e9',
    }
    
    # 添加节点
    for entity, e_type in entities.items():
        color = colors.get(e_type, '#dfe6e9')
        net.add_node(entity, label=entity, title=f"类型: {e_type}", color=color, size=30)
    
    # 添加边
    for source, rel, target in relations:
        if source in entities and target in entities:
            net.add_edge(source, target, title=rel, label=rel)
    
    return net

def create_networkx_graph(entities, relations):
    """创建 NetworkX 图（用于统计）"""
    G = nx.DiGraph()
    
    for entity, e_type in entities.items():
        G.add_node(entity, type=e_type)
    
    for source, rel, target in relations:
        G.add_edge(source, target, relation=rel)
    
    return G

# ============ Streamlit UI ============

st.set_page_config(page_title="🌐 知识图谱可视化", page_icon="🕸️", layout="wide")

st.title("🕸️ 本地知识图谱构建工具")
st.markdown("""
    输入一段文本，自动抽取实体和关系，并在浏览器中可视化！
""")

# 侧边栏
with st.sidebar:
    st.header("⚙️ 设置")
    
    use_simple = st.checkbox("使用简单抽取模式", value=True, 
                             help="简单模式抽取效果更好，复杂模式需要更多调试")
    
    st.markdown("---")
    st.markdown("### 📊 图谱统计")
    
    if 'entities' in st.session_state:
        st.metric("实体数量", len(st.session_state.entities))
        st.metric("关系数量", len(st.session_state.relations))
    
    st.markdown("---")
    st.markdown("### 🕸️ 图例")
    st.markdown("🔴 PERSON - 人物")
    st.markdown("🟢 ORG - 组织/公司")
    st.markdown("🟡 PRODUCT - 产品")
    st.markdown("🔵 LOCATION - 地点")

# 主输入区
text_input = st.text_area("📝 在这里输入文本内容：", height=150,
                          placeholder="例如：Elon Musk is the CEO of Tesla and SpaceX. Tesla makes electric vehicles including the Cybertruck. Apple was founded by Steve Jobs...")

col1, col2 = st.columns([1, 3])

with col1:
    if st.button("🚀 构建知识图谱", type="primary"):
        if text_input:
            with st.spinner("🔄 抽取实体和关系..."):
                entities, relations = build_graph(text_input, use_simple)
                st.session_state.entities = entities
                st.session_state.relations = relations
                
                if not entities:
                    st.warning("⚠️ 未检测到实体，请尝试更详细的描述")
                else:
                    st.success(f"✅ 成功提取 {len(entities)} 个实体, {len(relations)} 个关系")
        else:
            st.error("请输入文本内容")

# 显示结果
if 'entities' in st.session_state and st.session_state.entities:
    with col2:
        # 生成可视化
        net = create_pyvis_graph(st.session_state.entities, st.session_state.relations)
        
        # 保存为 HTML
        output_path = Path("/root/.openclaw/workspace-xiaokai/kg_output.html")
        net.save_graph(str(output_path))
        
        # 显示 HTML
        with open(output_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        st.components.v1.html(html_content, height=620)
    
    # 详细信息
    st.markdown("### 📋 详细结果")
    
    col_det1, col_det2 = st.columns(2)
    
    with col_det1:
        st.markdown("#### 🏷️ 实体列表")
        for entity, e_type in st.session_state.entities.items():
            st.write(f"- **{entity}** (`{e_type}`)")
    
    with col_det2:
        st.markdown("#### 🔗 关系列表")
        if st.session_state.relations:
            for source, rel, target in st.session_state.relations:
                st.write(f"- {source} → `{rel}` → {target}")
        else:
            st.write("未检测到关系")
    
    # 保存到 FalkorDB
    st.markdown("---")
    if st.button("💾 保存到 FalkorDB 图数据库"):
        try:
            import redis
            r = redis.Redis(host='localhost', port=6379, decode_responses=True)
            
            # 保存实体
            for entity, e_type in st.session_state.entities.items():
                r.hset(f"entity:{entity}", mapping={"name": entity, "type": e_type})
                r.sadd("entities", entity)
            
            # 保存关系
            for source, rel, target in st.session_state.relations:
                r.sadd(f"relations:{source}", f"{rel}:{target}")
                r.sadd(f"inverse:{target}", f"{rel}:{source}")
            
            st.success("✅ 已保存到 FalkorDB!")
        except Exception as e:
            st.error(f"保存失败: {e}")

else:
    st.markdown("### 💡 示例文本")
    
    # 示例选择
    example_type = st.radio("选择示例:", ["英文示例", "中文示例"], horizontal=True)
    
    if example_type == "英文示例":
        example_text = """Elon Musk is the CEO of Tesla and SpaceX. Tesla was founded by Elon Musk in 2003. 
Tesla makes electric vehicles including Model 3, Model Y, and Cybertruck. 
SpaceX was founded in 2002 and builds rockets. Elon Musk also owns Twitter, now called X.
Apple was founded by Steve Jobs in 1976. Tim Cook is the CEO of Apple.
Apple makes iPhone, iPad, and Mac computers. Apple acquired Beats in 2014."""
    else:
        example_text = """埃隆·马斯克是特斯拉公司的CEO，特斯拉公司成立于2003年，主要生产电动汽车。SpaceX公司成立于2002年，主要制造火箭。苹果公司由史蒂夫·乔布斯于1976年创立。蒂姆·库克是苹果公司的CEO。苹果公司生产iPhone和iPad。苹果公司收购了Beats公司。"""

    if 'example_loaded' not in st.session_state:
        st.session_state.example_loaded = False

    if st.button("📋 加载示例"):
        st.session_state.text_input = example_text
        st.session_state.example_loaded = True
        st.rerun()

# 使用 session_state 中的文本
if 'text_input' not in st.session_state:
    st.session_state.text_input = ""

text_input = st.text_area("📝 在这里输入文本内容：", height=150, key="main_text",
                          placeholder="例如：Elon Musk is the CEO of Tesla and SpaceX. Tesla makes electric vehicles including the Cybertruck. Apple was founded by Steve Jobs...",
                          value=st.session_state.text_input)
