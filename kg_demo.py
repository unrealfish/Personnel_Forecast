#!/usr/bin/env python3
"""
本地知识图谱演示 - 连接 FalkorDB
"""

import redis
import json

# 连接 FalkorDB (Redis 兼容)
def get_falkordb_client():
    return redis.Redis(host='localhost', port=6379, decode_responses=True)

def create_sample_knowledge_graph():
    """创建一个示例知识图谱"""
    r = get_falkordb_client()
    
    # 清空现有数据
    r.flushall()
    print("🗑️ 已清空现有数据")
    
    # 定义实体和关系
    entities = {
        "Person:Elon": {"name": "Elon Musk", "role": "CEO"},
        "Person:Tim": {"name": "Tim Cook", "role": "CEO"},
        "Company:Tesla": {"name": "Tesla", "industry": "Electric Vehicles"},
        "Company:Apple": {"name": "Apple", "industry": "Technology"},
        "Company:SpaceX": {"name": "SpaceX", "industry": "Aerospace"},
        "Product:Cybertruck": {"name": "Cybertruck", "type": "Electric Pickup"},
        "Product:iPhone": {"name": "iPhone", "type": "Smartphone"},
    }
    
    relations = [
        ("Person:Elon", "CEO_OF", "Company:Tesla"),
        ("Person:Elon", "CEO_OF", "Company:SpaceX"),
        ("Person:Tim", "CEO_OF", "Company:Apple"),
        ("Company:Tesla", "MAKES", "Product:Cybertruck"),
        ("Company:Apple", "MAKES", "Product:iPhone"),
    ]
    
    # 创建实体
    for entity_id, props in entities.items():
        r.hset(f"entity:{entity_id}", mapping=props)
        r.sadd("entities", entity_id)
    print(f"✅ 创建了 {len(entities)} 个实体")
    
    # 创建关系
    for source, relation, target in relations:
        r.sadd(f"relations:{source}", f"{relation}:{target}")
        r.sadd(f"inverse:{target}", f"{relation}:{source}")
    print(f"✅ 创建了 {len(relations)} 个关系")
    
    return True

def query_graph(entity_id=None):
    """查询知识图谱"""
    r = get_falkordb_client()
    
    if entity_id:
        # 查询特定实体
        entity_data = r.hgetall(f"entity:{entity_id}")
        outgoing = r.smembers(f"relations:{entity_id}")
        incoming = r.smembers(f"inverse:{entity_id}")
        
        print(f"\n📌 实体: {entity_id}")
        print(f"   属性: {entity_data}")
        print(f"   出向关系: {outgoing}")
        print(f"   入向关系: {incoming}")
    else:
        # 列出所有实体
        all_entities = r.smembers("entities")
        print(f"\n📊 知识图谱统计:")
        print(f"   实体数量: {len(all_entities)}")
        for e in all_entities:
            print(f"   - {e}")

def search_entities(keyword):
    """搜索实体"""
    r = get_falkordb_client()
    all_entities = r.smembers("entities")
    
    results = []
    for e in all_entities:
        entity_data = r.hgetall(f"entity:{e}")
        if any(keyword.lower() in str(v).lower() for v in entity_data.values()):
            results.append((e, entity_data))
    
    return results

if __name__ == "__main__":
    print("🚀 初始化知识图谱...")
    create_sample_knowledge_graph()
    query_graph()
    
    print("\n" + "="*50)
    print("🔍 搜索测试: 查找包含 'CEO' 的实体")
    results = search_entities("CEO")
    for e, data in results:
        print(f"   {e}: {data}")
    
    print("\n" + "="*50)
    print("📌 查询特定实体: Person:Elon")
    query_graph("Person:Elon")
    
    print("\n✨ 知识图谱演示完成！")
    print("📝 使用方法:")
    print("   python3 kg_demo.py              # 初始化并展示")
    print("   # 在代码中调用 search_entities() 搜索实体")
