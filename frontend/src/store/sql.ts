import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SQLTable {
  name: string
  columns: { name: string; type: string; pk?: boolean; fk?: string }[]
  rowCount: number
}

export interface QueryPlan {
  id?: string
  operation: string
  table?: string
  cost: number
  rows: number
  children: QueryPlan[]
  index?: string
  filter?: string
  detail?: string
}

export interface ParsedQuery {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'UNKNOWN'
  tables: string[]
  columns: string[]
  joins: { type: string; table: string; condition: string }[]
  whereConditions: string[]
  orderBy: string[]
  groupBy: string[]
  limit?: number
  distinct: boolean
  having?: string
  sargable: boolean
  complexity: number
  suggestions: string[]
  estimatedCost: number
}

/** SQL 中一个可点击的代码片段 */
export interface SQLSegment {
  key: string
  label: string
  text: string
  stepKey: string | null
  /** 纯文本片段（括号、分号等），不可点击 */
  plain?: boolean
}

/** 学习演示模式中的一个讲解步骤 */
export interface LearningStep {
  /** 与 SQLSegment.key 对应，用于双向高亮 */
  key: string
  order: number
  clauseLabel: string
  snippet: string
  explanation: string
  /** 执行计划树中被高亮的节点 id */
  nodeIds: string[]
}

const SCHEMA: SQLTable[] = [
  { name: 'users', rowCount: 50000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'username', type: 'VARCHAR(50)' },
    { name: 'email', type: 'VARCHAR(100)' }, { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'status', type: 'ENUM' }
  ]},
  { name: 'orders', rowCount: 200000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'user_id', type: 'INT', fk: 'users.id' },
    { name: 'product_id', type: 'INT', fk: 'products.id' }, { name: 'amount', type: 'DECIMAL' },
    { name: 'status', type: 'VARCHAR(20)' }, { name: 'created_at', type: 'TIMESTAMP' }
  ]},
  { name: 'products', rowCount: 10000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'name', type: 'VARCHAR(200)' },
    { name: 'price', type: 'DECIMAL' }, { name: 'category_id', type: 'INT', fk: 'categories.id' },
    { name: 'stock', type: 'INT' }
  ]},
  { name: 'categories', rowCount: 100, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'name', type: 'VARCHAR(50)' },
    { name: 'parent_id', type: 'INT' }
  ]},
]

function parseSQL(sql: string): ParsedQuery {
  const up = sql.toUpperCase().trim()
  const type = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'].find(t => up.startsWith(t)) as ParsedQuery['type'] || 'UNKNOWN'
  const tables = Array.from(sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi)).map(m => m[1].toLowerCase())
  const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM/i)
  const columns = type === 'SELECT'
    ? (selectMatch?.[1] || '').replace(/^\s*DISTINCT\s+/i, '').split(',').map(s => s.trim()).filter(Boolean)
    : []
  const joins = Array.from(sql.matchAll(/\s+(?:(LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+)?JOIN\s+([a-zA-Z_]\w*)(?:\s+(?:AS\s+)?(?!ON\b|USING\b|WHERE\b|JOIN\b)[a-zA-Z_]\w*)?\s+ON\s+([\s\S]*?)(?=\s+(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+JOIN\b|\s+JOIN\b|\s+WHERE\b|\s+GROUP\b|\s+ORDER\b|\s+LIMIT\b|;|$)/gi)).map(m => ({ type: (m[1] || 'INNER').toUpperCase(), table: m[2].toLowerCase(), condition: m[3].trim() }))
  const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT\b|;|$)/i)
  const whereConditions = whereMatch ? whereMatch[1].split(/\s+AND\s+|\s+OR\s+/i).map(s => s.trim()).filter(Boolean) : []
  const orderBy = (sql.match(/ORDER\s+BY\s+([\s\S]*?)(?:\s+LIMIT\b|;|$)/i)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean)
  const groupBy = (sql.match(/GROUP\s+BY\s+([\s\S]*?)(?:\s+HAVING|\s+ORDER\s+BY|\s+LIMIT\b|;|$)/i)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean)
  const having = sql.match(/HAVING\s+([\s\S]*?)(?:\s+ORDER\s+BY|\s+LIMIT\b|;|$)/i)?.[1]?.trim()
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined
  const distinct = /\bSELECT\s+DISTINCT\b/i.test(sql)

  // 判断 WHERE 条件能否走索引：对列使用函数、或前置通配符 LIKE 都会令索引失效
  const whereText = whereMatch?.[1] || ''
  const funcOnColumn = /\b(?:YEAR|MONTH|DAY|DATE|UPPER|LOWER|SUBSTRING|TRIM|CAST|COALESCE)\s*\(\s*[a-zA-Z_]\w*(?:\.\w+)?\s*[,)\s=<>]/i.test(whereText)
  const leadingWildcard = /LIKE\s+'%/i.test(whereText)
  const sargable = whereConditions.length > 0 && !funcOnColumn && !leadingWildcard

  const complexity = tables.length + joins.length * 2 + whereConditions.length + orderBy.length + (distinct ? 3 : 0) + (having ? 2 : 0)
  const estimatedCost = tables.reduce((sum, t) => { const tbl = SCHEMA.find(s => s.name === t); return sum + (tbl?.rowCount || 1000) }, 0) * (joins.length + 1) / (limit || 100)

  const suggestions: string[] = []
  if (joins.length > 3) suggestions.push('连接表过多（>3），考虑分解查询')
  if (!whereConditions.length && type === 'SELECT') suggestions.push('无 WHERE 条件，将扫描全表')
  if (sql.includes('SELECT *')) suggestions.push('避免 SELECT *，明确指定列名')
  if (/LIKE\s+'%/i.test(sql)) suggestions.push("前缀通配符 LIKE '%...' 无法使用索引")
  if (whereConditions.length && !sargable) suggestions.push('WHERE 中对索引列使用了函数或前置通配符，索引将失效并可能导致全表扫描')
  if (!limit && type === 'SELECT') suggestions.push('建议添加 LIMIT 限制结果集大小')

  return { type, tables, columns, joins, whereConditions, orderBy, groupBy, limit, distinct, having, sargable, complexity, suggestions, estimatedCost: Math.round(estimatedCost) }
}

/** 构建（模拟的）执行计划树，每个节点带稳定 id，供学习模式高亮 */
function buildPlan(parsed: ParsedQuery): QueryPlan {
  if (parsed.tables.length === 0) return { id: 'empty', operation: 'EMPTY', cost: 0, rows: 0, children: [] }

  const indexed = parsed.whereConditions.length > 0 && parsed.sargable
  const usedIndexTables = new Set<string>()

  function makeScan(t: string): QueryPlan {
    const tbl = SCHEMA.find(s => s.name === t)
    const total = tbl?.rowCount || 1000
    // 启发式：驱动表（第一张表）承担 WHERE 过滤，其余表通过连接键查找
    const useIndex = indexed && usedIndexTables.size === 0
    if (useIndex) usedIndexTables.add(t)
    return {
      id: 'scan-' + t,
      operation: useIndex ? 'Index Scan' : 'Seq Scan',
      table: t,
      cost: total * (useIndex ? 0.01 : 0.1),
      rows: Math.round(total * (useIndex ? 0.1 : 1)),
      children: [],
      index: useIndex ? 'idx_' + t + '_id' : undefined,
      detail: useIndex ? 'WHERE 过滤可走索引，预估只读取约 10% 的行' : '逐行读取整张表' + (total ? `（约 ${total.toLocaleString()} 行）` : ''),
    }
  }

  const scans = parsed.tables.map(makeScan)

  // 子查询中引用的额外表没有对应 JOIN，挂到驱动表下的 SubPlan 节点
  let subPlanNode: QueryPlan | undefined
  const joinTableCount = parsed.joins.length + 1
  if (scans.length > joinTableCount) {
    const inner = scans.slice(joinTableCount)
    const innerRows = inner.reduce((s, n) => s + n.rows, 0)
    subPlanNode = {
      id: 'subplan',
      operation: 'SubPlan',
      cost: inner.reduce((s, n) => s + n.cost, 0) * 1.2,
      rows: innerRows,
      children: inner,
      detail: '对外部查询的每一行执行括号中的子查询（物化 / Semi-Join 优化）',
    }
  }

  // 左深连接树：每一个 JOIN 子句对应一个 Hash Join 节点
  let root: QueryPlan = { ...scans[0] }
  if (subPlanNode) root.children = [subPlanNode]
  let currentRows = root.rows

  parsed.joins.forEach((j, i) => {
    const right = scans[i + 1]
    const joinRows = Math.round(currentRows * 0.5)
    const join: QueryPlan = {
      id: 'join-' + j.table,
      operation: j.type === 'CROSS' ? 'Nested Loop' : 'Hash Join',
      table: j.table,
      cost: (root.cost + right.cost) * 1.5,
      rows: joinRows,
      children: [root, right],
      filter: j.condition,
      detail: `${j.type} JOIN：以 ${j.condition} 匹配左右两侧行`,
    }
    root = join
    currentRows = joinRows
  })

  if (parsed.groupBy.length) {
    root = {
      id: 'aggregate',
      operation: 'HashAggregate',
      cost: root.cost * 1.3,
      rows: Math.max(1, Math.round(root.rows * 0.02)),
      children: [root],
      detail: '按 ' + parsed.groupBy.join(', ') + ' 分组并计算聚合函数',
    }
  }
  if (parsed.having) {
    root = {
      id: 'having',
      operation: 'Filter',
      cost: root.cost * 1.05,
      rows: Math.max(1, Math.round(root.rows * 0.5)),
      children: [root],
      filter: parsed.having,
      detail: 'HAVING 在聚合之后过滤分组结果',
    }
  }
  if (parsed.distinct) {
    root = {
      id: 'distinct',
      operation: 'Unique',
      cost: root.cost * 1.15,
      rows: Math.max(1, Math.round(root.rows * 0.3)),
      children: [root],
      detail: 'DISTINCT 对结果集去重（通常借助排序或哈希表）',
    }
  }
  if (parsed.orderBy.length) {
    root = {
      id: 'sort',
      operation: 'Sort',
      cost: root.cost * 1.2,
      rows: root.rows,
      children: [root],
      detail: '按 ' + parsed.orderBy.join(', ') + ' 排序',
    }
  }
  if (parsed.limit !== undefined) {
    root = {
      id: 'limit',
      operation: 'Limit',
      cost: root.cost * 1.02,
      rows: Math.min(parsed.limit, root.rows),
      children: [root],
      detail: `取前 ${parsed.limit} 行后提前停止扫描`,
    }
  }

  root = {
    id: 'result',
    operation: 'Result',
    cost: root.cost * 1.05,
    rows: root.rows,
    children: [root],
    detail: '投影 SELECT 列表中的列并返回最终结果',
  }
  return root
}

interface ClauseMatch { key: string, start: number, kw: string }

const CLAUSE_DEFS: { key: string, label: string, re: RegExp, orderKeys: string[] }[] = [
  { key: 'SELECT', label: 'SELECT 投影列', re: /\bSELECT(\s+DISTINCT)?\b/gi, orderKeys: ['SELECT', 'DISTINCT'] },
  { key: 'FROM', label: 'FROM 数据源', re: /\bFROM\b/gi, orderKeys: ['FROM'] },
  { key: 'JOIN', label: 'JOIN 连接', re: /\b(?:(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+)?JOIN\b/gi, orderKeys: [] },
  { key: 'WHERE', label: 'WHERE 过滤', re: /\bWHERE\b/gi, orderKeys: ['WHERE', 'HAVING'] },
  { key: 'GROUP_BY', label: 'GROUP BY 分组', re: /\bGROUP\s+BY\b/gi, orderKeys: ['GROUP_BY'] },
  { key: 'HAVING', label: 'HAVING 分组过滤', re: /\bHAVING\b/gi, orderKeys: ['WHERE', 'HAVING'] },
  { key: 'ORDER_BY', label: 'ORDER BY 排序', re: /\bORDER\s+BY\b/gi, orderKeys: ['ORDER_BY'] },
  { key: 'LIMIT', label: 'LIMIT 行数限制', re: /\bLIMIT\b/gi, orderKeys: ['LIMIT'] },
]

/** 找出括号内以 SELECT 开头的子查询区间（跳过字符串字面量） */
function findSubqueryRanges(sql: string): [number, number][] {
  const ranges: [number, number][] = []
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== '(') continue
    let j = i + 1
    while (j < sql.length && /\s/.test(sql[j])) j++
    if (!/^SELECT\b/i.test(sql.slice(j, j + 7))) continue
    // 扫描匹配的右括号
    let depth = 1, k = i + 1
    while (k < sql.length && depth > 0) {
      const ch = sql[k]
      if (ch === "'") { while (++k < sql.length && sql[k] !== "'") { if (sql[k] === '\\') k++ }; k++; continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
      k++
    }
    ranges.push([i, k]) // k 指向右括号之后
    i = k - 1
  }
  return ranges
}

/** 把 SQL 按子句切成有序片段，保留原始空白；返回原始位置信息供排序使用 */
function extractPieces(sql: string): { key: string, label: string, text: string }[] {
  const subRanges = findSubqueryRanges(sql)
  const inSubquery = (p: number) => subRanges.some(([a, b]) => p >= a && p < b)

  const matches: ClauseMatch[] = []
  for (const def of CLAUSE_DEFS) {
    def.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = def.re.exec(sql))) {
      if (inSubquery(m.index)) continue
      matches.push({ key: def.key, start: m.index, kw: m[0] })
    }
  }
  matches.sort((a, b) => a.start - b.start)

  const pieces: { key: string, label: string, text: string; start: number; end: number }[] = []
  const joinSeen = new Set<string>()

  // 子查询片段（取最外层范围；嵌套子查询会随其文本一并展示）
  subRanges.forEach(([a, b], i) => {
    pieces.push({ key: 'SUBQUERY_' + i, label: '子查询', text: sql.slice(a, b), start: a, end: b })
  })

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const isWhere = cur.key === 'WHERE'
    const nextStart = matches[i + 1]?.start ?? sql.length
    // WHERE 若包含子查询，只讲解到子查询括号之前
    let end = nextStart
    if (isWhere) {
      const sub = subRanges.find(([a]) => a > cur.start && a < nextStart)
      if (sub) end = sub[0]
    }
    const text = sql.slice(cur.start, end)
    if (!text.trim()) continue
    let key = cur.key
    if (cur.key === 'JOIN') {
      const tbl = sql.slice(cur.start).match(/JOIN\s+([a-zA-Z_]\w*)/i)
      key = 'JOIN_' + (tbl?.[1] || joinSeen.size + 1)
      joinSeen.add(key)
    }
    const label = CLAUSE_DEFS.find(d => d.key === cur.key)!.label
    pieces.push({ key, label, text, start: cur.start, end })
  }

  pieces.sort((a, b) => a.start - b.start)

  // 补上片段之间未被任何子句覆盖的纯文本（SELECT 之前的空白、结尾分号等）
  const segments: { key: string, label: string, text: string; start: number; end: number }[] = []
  let cursor = 0
  for (const p of pieces) {
    if (p.start > cursor) segments.push({ key: 'PLAIN_' + cursor, label: '', text: sql.slice(cursor, p.start), start: cursor, end: p.start })
    segments.push(p)
    cursor = p.end
  }
  if (cursor < sql.length) segments.push({ key: 'PLAIN_END', label: '', text: sql.slice(cursor), start: cursor, end: sql.length })

  return segments.filter(s => s.text.length).map(({ key, label, text }) => ({ key, label, text }))
}

function buildSegments(sql: string): SQLSegment[] {
  return extractPieces(sql).map(p => ({
    key: p.key,
    label: p.label,
    text: p.text,
    stepKey: p.key.startsWith('PLAIN_') ? null : p.key,
    plain: p.key.startsWith('PLAIN_'),
  }))
}

/** 按数据库逻辑执行顺序生成学习步骤 */
function buildLearningSteps(sql: string, parsed: ParsedQuery): LearningStep[] {
  const pieces = extractPieces(sql)
  const byKey = new Map(pieces.map(p => [p.key, p]))
  const snippet = (key: string) => byKey.get(key)?.text.trim() || ''
  const steps: LearningStep[] = []
  const joinTableCount = parsed.joins.length + 1
  const hasSubquery = pieces.some(p => p.key.startsWith('SUBQUERY_'))

  // 1) FROM：驱动表
  const driver = parsed.tables[0]
  steps.push({
    key: 'FROM', order: 1, clauseLabel: 'FROM 数据源',
    snippet: snippet('FROM'),
    explanation: `从表 ${driver} 开始读取数据。执行器先在该表上做 ${parsed.sargable && parsed.whereConditions.length ? 'Index Scan（索引扫描）' : 'Seq Scan（顺序扫描 / 全表扫描）'}，这是整个查询的「驱动表」，后续连接都以它的行为基准向外扩展。`,
    nodeIds: ['scan-' + driver],
  })

  // 2) 子查询（出现在 WHERE 中时，作为 Semi-Join 在连接阶段求值）
  const subPiece = pieces.find(p => p.key.startsWith('SUBQUERY_'))
  if (subPiece) {
    steps.push({
      key: subPiece.key, order: steps.length + 1, clauseLabel: '子查询',
      snippet: subPiece.text.trim(),
      explanation: `括号中的子查询先独立执行，产出一列（或一组）值，再交给外层的 ${/=|>|<|>=|<=/.test(parsed.whereConditions.join(' ')) ? '比较表达式' : 'IN / EXISTS'} 做匹配。优化器通常会把它改写为 Semi-Join，而不是对外层每行重复执行。`,
      nodeIds: ['subplan', ...parsed.tables.slice(joinTableCount).map(t => 'scan-' + t)],
    })
  }

  // 3) JOIN：按书写顺序逐个连接
  parsed.joins.forEach((j, i) => {
    const key = pieces.find(p => p.key === 'JOIN_' + j.table)?.key || 'JOIN_' + j.table
    const joinKind = j.type === 'LEFT' ? '左外连接（保留左表全部行）'
      : j.type === 'RIGHT' ? '右外连接（保留右表全部行）'
      : j.type === 'CROSS' ? '笛卡尔积连接'
      : '内连接（只保留匹配成功的行）'
    steps.push({
      key, order: steps.length + 1, clauseLabel: `${j.type} JOIN 连接`,
      snippet: snippet(key),
      explanation: `第 ${i + 1} 个连接，把 ${j.table} 表按条件「${j.condition}」与前面的中间结果做${joinKind}。计划中用 Hash Join：先对较小一侧建哈希表，再探测另一侧，时间复杂度近似 O(m+n)。`,
      nodeIds: ['join-' + j.table, 'scan-' + j.table],
    })
  })

  // 4) WHERE：行级过滤
  if (parsed.whereConditions.length) {
    const nodeIds = ['scan-' + driver]
    if (hasSubquery) nodeIds.push('subplan')
    steps.push({
      key: 'WHERE', order: steps.length + 1, clauseLabel: 'WHERE 行过滤',
      snippet: snippet('WHERE'),
      explanation: `WHERE 在连接前后尽早执行，逐行应用 ${parsed.whereConditions.length} 个过滤条件（${parsed.whereConditions.map(c => '「' + c + '」').join('、')}），减少进入后续算子的行数。${parsed.sargable ? '条件为「可搜索参数（SARGable）」形式，可以利用索引快速定位。' : '⚠ 条件对列使用了函数或前置通配符，索引失效，优化器只能逐行判断，可能导致全表扫描。'}`,
      nodeIds,
    })
  }

  // 5) GROUP BY
  if (parsed.groupBy.length) {
    steps.push({
      key: 'GROUP_BY', order: steps.length + 1, clauseLabel: 'GROUP BY 分组',
      snippet: snippet('GROUP_BY'),
      explanation: `WHERE 过滤之后，按 ${parsed.groupBy.join('、')} 将数据分成若干组，COUNT / SUM / AVG 等聚合函数对每一组分别计算，每组输出一行。计划中对应 HashAggregate 节点。`,
      nodeIds: ['aggregate'],
    })
  }

  // 6) HAVING：聚合后过滤
  if (parsed.having) {
    steps.push({
      key: 'HAVING', order: steps.length + 1, clauseLabel: 'HAVING 分组过滤',
      snippet: snippet('HAVING'),
      explanation: `HAVING 在 GROUP BY 聚合完成之后执行，针对的是聚合结果（如 COUNT(o.id) > 10），过滤掉不满足条件的整组。注意它不能像 WHERE 那样在扫描阶段提前过滤。`,
      nodeIds: ['having', 'aggregate'],
    })
  }

  // 7) SELECT：投影
  steps.push({
    key: 'SELECT', order: steps.length + 1, clauseLabel: 'SELECT 投影',
    snippet: snippet('SELECT'),
    explanation: `过滤与聚合完成后，SELECT 列表（${parsed.columns.slice(0, 4).map(c => '`' + c + '`').join('、')}${parsed.columns.length > 4 ? ' 等' : ''}）决定最终输出哪些列并计算表达式，这一步称为投影。`,
    nodeIds: ['result'],
  })

  // 8) DISTINCT（复用 SELECT 片段的高亮）
  if (parsed.distinct) {
    steps.push({
      key: 'SELECT', order: steps.length + 1, clauseLabel: 'DISTINCT 去重',
      snippet: snippet('SELECT'),
      explanation: `DISTINCT 对投影后的结果集去重，数据库通常用排序后跳过重复值、或哈希表两种方式实现，对应计划中的 Unique 节点。去重需要读取并比较全部行，代价不低。`,
      nodeIds: ['distinct', 'result'],
    })
  }

  // 9) ORDER BY
  if (parsed.orderBy.length) {
    steps.push({
      key: 'ORDER_BY', order: steps.length + 1, clauseLabel: 'ORDER BY 排序',
      snippet: snippet('ORDER_BY'),
      explanation: `按 ${parsed.orderBy.join('、')} 对最终结果排序，对应 Sort 节点。小结果集在内存中排序，超出 work_mem 时会溢出到磁盘，因此大结果集排序开销显著。`,
      nodeIds: ['sort'],
    })
  }

  // 10) LIMIT
  if (parsed.limit !== undefined) {
    steps.push({
      key: 'LIMIT', order: steps.length + 1, clauseLabel: 'LIMIT 截断',
      snippet: snippet('LIMIT'),
      explanation: `只取前 ${parsed.limit} 行。LIMIT 在计划栈最顶端，执行器取够行数即可提前终止下层节点（与排序配合时仍需先排完序）。`,
      nodeIds: ['limit'],
    })
  }

  return steps
}

export const SQL_TEMPLATES = [
  { name: '基础查询', sql: `SELECT id, username, email
FROM users
WHERE status = 'active'
LIMIT 100;` },
  { name: '多表JOIN', sql: `SELECT u.username, o.id AS order_id, p.name AS product, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id
INNER JOIN products p ON o.product_id = p.id
WHERE o.status = 'completed'
ORDER BY o.created_at DESC
LIMIT 50;` },
  { name: '聚合分析', sql: `SELECT c.name AS category, COUNT(o.id) AS order_count, SUM(o.amount) AS revenue, AVG(o.amount) AS avg_amount
FROM categories c
LEFT JOIN products p ON c.id = p.category_id
LEFT JOIN orders o ON p.id = o.product_id
GROUP BY c.id, c.name
HAVING COUNT(o.id) > 10
ORDER BY revenue DESC;` },
  { name: '子查询', sql: `SELECT username, email
FROM users
WHERE id IN (
  SELECT DISTINCT user_id
  FROM orders
  WHERE amount > 1000
  AND created_at >= '2024-01-01'
)
ORDER BY username;` },
  { name: '全表扫描', sql: `SELECT *
FROM orders
WHERE YEAR(created_at) = 2024;` },
]

export const SCHEMA_TABLES = SCHEMA

let autoplayTimer: ReturnType<typeof setInterval> | undefined

export const useSQLStore = defineStore('sql', () => {
  const sql = ref(SQL_TEMPLATES[0].sql)
  const parsed = ref<ParsedQuery | null>(null)
  const plan = ref<QueryPlan | null>(null)
  const activeSchema = ref<SQLTable | null>(null)

  // 学习演示模式状态
  const learningMode = ref(false)
  const learningSteps = ref<LearningStep[]>([])
  const sqlSegments = ref<SQLSegment[]>([])
  const learningStep = ref(0)
  const isPlaying = ref(false)

  function stopAutoplay() {
    if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = undefined }
    isPlaying.value = false
  }

  function analyze() {
    stopAutoplay()
    parsed.value = parseSQL(sql.value)
    plan.value = buildPlan(parsed.value)
    if (parsed.value.type === 'SELECT') {
      learningSteps.value = buildLearningSteps(sql.value, parsed.value)
      sqlSegments.value = buildSegments(sql.value)
    } else {
      learningMode.value = false
      learningSteps.value = []
      sqlSegments.value = []
    }
    learningStep.value = 0
  }

  const currentStep = computed(() => learningSteps.value[learningStep.value] || null)

  const activeNodeIds = computed<Set<string>>(() => new Set(currentStep.value?.nodeIds || []))
  const activeSegmentKeys = computed<Set<string>>(() => new Set(currentStep.value ? [currentStep.value.key] : []))

  function toggleLearning() {
    if (!learningSteps.value.length) return
    learningMode.value = !learningMode.value
    stopAutoplay()
    learningStep.value = 0
  }

  function setLearningStep(i: number) {
    const n = learningSteps.value.length
    if (!n) return
    learningStep.value = ((i % n) + n) % n
  }

  function nextStep() { setLearningStep(learningStep.value + 1) }
  function prevStep() { setLearningStep(learningStep.value - 1) }

  function toggleAutoplay() {
    if (isPlaying.value) { stopAutoplay(); return }
    isPlaying.value = true
    autoplayTimer = setInterval(() => {
      if (learningStep.value >= learningSteps.value.length - 1) stopAutoplay()
      else nextStep()
    }, 2500)
  }

  /** 点击 SQL 片段：跳转到讲解该片段的步骤 */
  function jumpToSegment(key: string) {
    const i = learningSteps.value.findIndex(s => s.key === key)
    if (i >= 0) setLearningStep(i)
  }

  function findNode(id: string, node: QueryPlan | null = plan.value): QueryPlan | null {
    if (!node) return null
    if (node.id === id) return node
    for (const c of node.children) {
      const hit = findNode(id, c)
      if (hit) return hit
    }
    return null
  }

  function nodeLabel(id: string): string {
    const n = findNode(id)
    if (!n) return id
    return n.table ? `${n.operation} on ${n.table}` : n.operation
  }

  const complexityLabel = computed(() => {
    const c = parsed.value?.complexity || 0
    if (c <= 2) return { label: '简单', color: 'text-green-400' }
    if (c <= 5) return { label: '中等', color: 'text-yellow-400' }
    if (c <= 8) return { label: '复杂', color: 'text-orange-400' }
    return { label: '非常复杂', color: 'text-red-400' }
  })

  return {
    sql, parsed, plan, activeSchema, complexityLabel, analyze,
    learningMode, learningSteps, sqlSegments, learningStep, currentStep,
    activeNodeIds, activeSegmentKeys, isPlaying,
    toggleLearning, setLearningStep, nextStep, prevStep, toggleAutoplay,
    jumpToSegment, nodeLabel,
  }
})
