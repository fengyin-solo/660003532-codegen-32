<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">SQL 查询可视化与执行计划分析器</h1>
      <p class="text-sm text-slate-500 mt-1">SQL语法解析 · 执行计划树 · ER图 · 复杂度评分 · 优化建议</p>
    </header>
    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-2/5 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">SQL 编辑器</h3>
            <div class="flex gap-2">
              <select @change="(e) => { store.sql = SQL_TEMPLATES[+(e.target as HTMLSelectElement).value].sql }" class="text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-300">
                <option v-for="(t, i) in SQL_TEMPLATES" :key="i" :value="i">{{ t.name }}</option>
              </select>
            </div>
          </div>
          <textarea v-model="store.sql" rows="12" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-green-400 focus:outline-none focus:border-cyan-500 resize-none"></textarea>
          <button @click="store.analyze" class="w-full mt-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">分析查询</button>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">数据库 Schema</h3>
          <div class="space-y-2">
            <div v-for="t in SCHEMA_TABLES" :key="t.name" @click="store.activeSchema = store.activeSchema?.name === t.name ? null : t"
              :class="['cursor-pointer rounded border p-2 text-xs transition-all', store.activeSchema?.name === t.name ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 hover:border-slate-500']">
              <div class="flex justify-between items-center">
                <span class="font-bold text-slate-200">{{ t.name }}</span>
                <span class="text-slate-500">{{ t.rowCount.toLocaleString() }} 行</span>
              </div>
              <div v-if="store.activeSchema?.name === t.name" class="mt-2 space-y-0.5">
                <div v-for="c in t.columns" :key="c.name" class="flex gap-2">
                  <span :class="c.pk ? 'text-yellow-400' : c.fk ? 'text-blue-400' : 'text-slate-400'">{{ c.pk ? '🔑 ' : c.fk ? '🔗 ' : '  ' }}{{ c.name }}</span>
                  <span class="text-slate-600">{{ c.type }}</span>
                  <span v-if="c.fk" class="text-blue-600">→ {{ c.fk }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="lg:w-3/5 space-y-4">
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">查询解析结果</h3>
          <div class="grid grid-cols-4 gap-3 text-sm mb-4">
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">类型</div><div class="text-cyan-400 font-bold">{{ store.parsed.type }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">复杂度</div><div class="font-bold" :class="store.complexityLabel.color">{{ store.complexityLabel.label }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">JOIN数</div><div class="text-orange-400 font-bold">{{ store.parsed.joins.length }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">预估行数</div><div class="text-purple-400 font-bold">{{ store.parsed.estimatedCost }}</div></div>
          </div>
          <div v-if="store.parsed.suggestions.length" class="space-y-1">
            <div class="text-xs text-slate-500 mb-1">优化建议</div>
            <div v-for="(s, i) in store.parsed.suggestions" :key="i" class="text-xs flex items-start gap-2 bg-orange-900/30 border border-orange-700 rounded p-2">
              <span class="text-orange-400">⚠</span><span class="text-orange-300">{{ s }}</span>
            </div>
          </div>
          <div v-else class="text-xs text-green-400 bg-green-900/20 border border-green-700 rounded p-2">✓ 未发现明显性能问题</div>
        </div>
        <div v-if="store.plan" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">执行计划树</h3>
            <button v-if="store.parsed?.type === 'SELECT'" @click="store.toggleLearning()"
              :class="['text-xs px-3 py-1 rounded font-bold transition-colors', store.learningMode ? 'bg-cyan-500 text-slate-900' : 'bg-slate-700 text-cyan-300 hover:bg-slate-600']">
              {{ store.learningMode ? '■ 退出演示' : '▶ 学习演示模式' }}
            </button>
          </div>

          <!-- 学习演示面板 -->
          <div v-if="store.learningMode && store.currentStep" class="mb-4 rounded-lg border border-cyan-700/60 bg-slate-900/70 overflow-hidden">
            <!-- 分段高亮的 SQL -->
            <div class="border-b border-slate-700 p-3">
              <div class="text-[10px] text-slate-500 mb-1.5">点击任意高亮子句可跳转到对应讲解（← → 键切换步骤）</div>
              <pre class="text-xs font-mono whitespace-pre-wrap break-words leading-6"><template v-for="(seg, i) in store.sqlSegments" :key="i"><span
                    v-if="!seg.plain"
                    @click="store.jumpToSegment(seg.key)"
                    :title="seg.label"
                    :class="['rounded px-0.5 cursor-pointer transition-all', store.activeSegmentKeys.has(seg.key) ? 'bg-cyan-500 text-slate-900 font-bold shadow-[0_0_8px_rgba(6,182,212,0.7)]' : 'bg-cyan-900/30 text-cyan-200 hover:bg-cyan-800/50 underline decoration-cyan-700 decoration-dotted underline-offset-2']">{{ seg.text }}</span><span v-else class="text-slate-500">{{ seg.text }}</span></template></pre>
            </div>

            <!-- 控制条 -->
            <div class="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800/60">
              <button @click="store.prevStep()" class="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200">← 上一步</button>
              <button @click="store.toggleAutoplay()" class="text-xs px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-bold">{{ store.isPlaying ? '⏸ 暂停' : '▶ 自动播放' }}</button>
              <button @click="store.nextStep()" class="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200">下一步 →</button>
              <span class="text-xs text-slate-400 ml-1">步骤 {{ store.learningStep + 1 }} / {{ store.learningSteps.length }}</span>
              <span class="text-xs text-cyan-400 ml-auto font-bold">{{ store.currentStep.order }}. {{ store.currentStep.clauseLabel }}</span>
            </div>

            <!-- 当前步骤讲解 -->
            <div class="p-3 space-y-2">
              <pre class="text-xs font-mono whitespace-pre-wrap break-words text-green-300 bg-slate-950/60 rounded p-2 border border-slate-700">{{ store.currentStep.snippet }}</pre>
              <p class="text-xs leading-5 text-slate-300">{{ store.currentStep.explanation }}</p>
              <div class="flex flex-wrap gap-1.5 pt-1">
                <span class="text-[10px] text-slate-500 self-center">对应计划节点：</span>
                <span v-for="id in store.currentStep.nodeIds" :key="id"
                  class="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/50 border border-cyan-600 text-cyan-300">▸ {{ store.nodeLabel(id) }}</span>
              </div>
              <div class="flex flex-wrap gap-1 pt-1">
                <button v-for="(s, i) in store.learningSteps" :key="s.key" @click="store.setLearningStep(i)"
                  :class="['w-5 h-5 rounded-full text-[10px] font-bold transition-colors', i === store.learningStep ? 'bg-cyan-500 text-slate-900' : 'bg-slate-700 text-slate-400 hover:bg-slate-600']">{{ i + 1 }}</button>
              </div>
            </div>
          </div>

          <div class="overflow-x-auto">
            <div class="font-mono text-xs text-slate-300 space-y-1">
              <PlanNode :node="store.plan" :depth="0" :active-ids="store.activeNodeIds" />
            </div>
          </div>
        </div>
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">涉及表与关联关系</h3>
          <canvas ref="erCanvasRef" class="w-full bg-slate-900 rounded" style="height:200px"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, defineComponent, h } from 'vue'
import { useSQLStore, SQL_TEMPLATES, SCHEMA_TABLES } from './store/sql'

const store = useSQLStore()
const erCanvasRef = ref<HTMLCanvasElement | null>(null)

const PlanNode = defineComponent({
  props: { node: Object, depth: Number, activeIds: { type: Set, default: () => new Set<string>() } },
  setup(props) {
    return () => {
      if (!props.node) return null
      const n = props.node as any
      const depth = props.depth || 0
      const indent = '  '.repeat(depth)
      const opColor = n.operation.includes('Scan') ? '#22c55e'
        : n.operation.includes('Join') || n.operation === 'Nested Loop' ? '#f97316'
        : n.operation.includes('Sort') ? '#8b5cf6'
        : n.operation.includes('Aggregate') ? '#ec4899'
        : n.operation === 'Limit' ? '#eab308'
        : n.operation === 'Unique' ? '#14b8a6'
        : '#06b6d4'
      const active = !!n.id && (props.activeIds as Set<string>).has(n.id)
      return h('div', {
        style: 'border-radius:4px',
        class: active
          ? 'bg-cyan-500/20 ring-1 ring-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)] transition-all'
          : 'transition-all',
        'data-node-id': n.id,
      }, [
        h('div', { style: `padding:2px 4px 2px ${depth * 20 + 4}px` }, [
          active ? h('span', { style: 'color:#22d3ee;font-weight:bold;margin-right:4px' }, '▶') : null,
          h('span', { style: 'color: #475569' }, indent.replace(/\s\s/g, '│ ').replace(/│ $/, '└─')),
          h('span', { style: `color: ${opColor}; font-weight: bold` }, n.operation),
          n.table ? h('span', { style: 'color: #94a3b8' }, ` on ${n.table}`) : null,
          n.index ? h('span', { style: 'color: #eab308' }, ` [${n.index}]`) : null,
          h('span', { style: 'color: #64748b' }, ` cost=${n.cost.toFixed(1)} rows=${n.rows}`),
          n.filter ? h('div', { style: 'color:#a78bfa;padding-left:12px;font-size:11px' }, `filter: ${n.filter}`) : null,
          active && n.detail ? h('div', { style: 'color:#67e8f9;padding-left:16px;font-size:11px' }, 'ⓘ ' + n.detail) : null,
        ]),
        ...(n.children || []).map((child: any) => h(PlanNode, { node: child, depth: depth + 1, activeIds: props.activeIds }))
      ])
    }
  }
})

function drawER() {
  const canvas = erCanvasRef.value
  if (!canvas || !store.parsed) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const tables = store.parsed.tables
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const W = canvas.width, H = 200
  const spacing = W / (tables.length + 1)
  const positions: Record<string, { x: number; y: number }> = {}
  tables.forEach((t, i) => { positions[t] = { x: spacing * (i + 1), y: H / 2 } })

  // Draw joins
  store.parsed.joins.forEach(j => {
    const src = positions[tables[0]]
    const dst = positions[j.table]
    if (!src || !dst) return
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(dst.x, dst.y)
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
    const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2
    ctx.fillStyle = '#f97316'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(j.type, mx, my - 5)
  })

  // Draw table boxes
  tables.forEach((t, i) => {
    const pos = positions[t]
    if (!pos) return
    const x = pos.x, y = pos.y
    ctx.fillStyle = '#1e293b'
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x - 50, y - 30, 100, 60, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#06b6d4'
    ctx.font = 'bold 13px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t, x, y - 10)
    const schema = SCHEMA_TABLES.find(s => s.name === t)
    if (schema) {
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      ctx.fillText(schema.rowCount.toLocaleString() + ' rows', x, y + 10)
    }
  })
}

onMounted(() => { store.analyze(); setTimeout(drawER, 200) })
watch(() => store.parsed, () => setTimeout(drawER, 100), { deep: true })

// 学习模式下：高亮节点自动滚动到可视区域
watch(() => store.learningStep, () => {
  if (!store.learningMode) return
  const id = store.currentStep?.nodeIds[0]
  if (!id) return
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-node-id="${id}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})

// 学习模式键盘导航：← 上一步，→ 下一步
function onKeydown(e: KeyboardEvent) {
  if (!store.learningMode) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return
  if (e.key === 'ArrowRight') { e.preventDefault(); store.nextStep() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); store.prevStep() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>
