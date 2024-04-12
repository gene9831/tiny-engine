<template>
  <plugin-panel class="outlinebox" title="大纲树" @close="$emit('close')">
    <template #header>
      <svg-button
        class="item icon-sidebar"
        :class="[fixedPanels?.includes(PLUGIN_NAME.OutlineTree) && 'active']"
        :tips="!fixedPanels?.includes(PLUGIN_NAME.OutlineTree) ? '固定面板' : '解除固定面板'"
        @click="$emit('fixPanel', PLUGIN_NAME.OutlineTree)"
        name="fixed"
      ></svg-button>
    </template>
    <template #content>
      <div
        ref="treeContainer"
        :class="['tree-wrap', 'lowcode-scrollbar', { 'tree-grabbing': isDragging, 'tree-row-hover': !isDragging }]"
        tabindex="0"
        @mousemove="handleMouseMove"
        @keydown="handleKeyDown"
        @copy="handleClipboardEvent"
        @cut="handleClipboardEvent"
        @paste="handleClipboardEvent"
      >
        <div
          v-for="id in treeRowIds"
          :key="id"
          :data-node-id="id"
          :class="[
            'tree-row',
            {
              dragging: selectedId === id && isDragging,
              selected: selectedId === id && !isDragging
            }
          ]"
          :style="{
            top: `${treeRowMap[id].index * 28}px`,
            'z-index': getRowZIndex(id)
          }"
          @mousedown="handleMouseDown($event, id)"
          @mouseover="handleMouseOver($event, id)"
          @mouseleave="handleMouseLeave"
        >
          <svg v-for="i in treeRowMap[id].depth" :key="i" :viewBox="`0 0 16 28`" width="16" height="28">
            <line
              x1="8"
              x2="8"
              y1="0"
              y2="28"
              :class="['polyline', { highlight: treeRowMap[id].highlight && i - 1 === highlightDepth }]"
            ></line>
          </svg>
          <span
            :class="{
              collapse: getRowProp(id, 'collapse'),
              'visibility-hidden': !(nodeIsContainer(treeDataMap[id].node) || treeDataMap[id].node.children?.length)
            }"
            @click="handleExpand(id)"
          >
            <icon-chevron-down></icon-chevron-down>
          </span>
          <span :class="['row-label', { placeholder: id === 'placeholder', error: notAllowInsert }]">
            {{ treeDataMap[id].node.componentName }}
          </span>
          <span class="eye-tool" v-show="showVisibilityToggle(id)" @mouseup="toggleVisibility(id)">
            <icon-eyeopen v-show="!getRowProp(id, 'hide')"></icon-eyeopen>
            <icon-eyeclose v-show="getRowProp(id, 'hide')"></icon-eyeclose>
          </span>
        </div>
        <div
          v-show="isDragging"
          class="popup-label"
          :style="{
            left: `${draggingPosition.x}px`,
            top: `${draggingPosition.y}px`
          }"
        >
          {{ treeDataMap[selectedId]?.node.componentName }}
        </div>
      </div>
    </template>
  </plugin-panel>
</template>

<script>
import { reactive, watch, ref, onActivated, computed, nextTick } from 'vue'
import { PluginPanel, SvgButton } from '@opentiny/tiny-engine-common'
import { constants } from '@opentiny/tiny-engine-utils'
import { iconChevronDown, iconEyeopen, iconEyeclose } from '@opentiny/vue-icon'
import { useCanvas, useResource, useLayout, useHistory } from '@opentiny/tiny-engine-controller'
import { extend } from '@opentiny/vue-renderless/common/object'
import { typeOf } from '@opentiny/vue-renderless/common/type'
import {
  allowInsert,
  getRenderer,
  clearSelect,
  selectNode,
  hoverNode,
  getConfigure,
  handlerClipboardEvent,
  handlerDelete
} from '@opentiny/tiny-engine-canvas'
import { getSchema } from '@opentiny/tiny-engine-canvas'

const { PAGE_STATUS } = constants
export default {
  components: {
    PluginPanel,
    SvgButton,
    IconChevronDown: iconChevronDown(),
    IconEyeopen: iconEyeopen(),
    IconEyeclose: iconEyeclose()
  },
  props: {
    fixedPanels: {
      type: Array
    }
  },
  emits: ['close', 'fix-panel'],
  setup() {
    const { pageState } = useCanvas()
    const { getMaterial } = useResource()

    const filterSchema = (data) => {
      const translateChild = (data) => {
        data.forEach((item) => {
          item.show = pageState.nodesStatus[item.id] !== false
          const child = item.children
          if (typeOf(child) !== 'array') {
            delete item.children
          } else {
            if (item.children.length) {
              translateChild(item.children)
            }
          }
        })

        return data
      }

      return { ...translateChild([extend(true, {}, data)])[0] }
    }

    const treeData2Map = (node, parent = null) => {
      const result = { [node.id]: { node, parent } }

      for (const child of node.children || []) {
        Object.assign(result, treeData2Map(child, node))
      }

      return result
    }

    const { PLUGIN_NAME } = useLayout()
    const state = reactive({
      pageSchema: {},
      isLock: computed(
        () => ![PAGE_STATUS.Occupy, PAGE_STATUS.Guest].includes(useLayout().layoutState.pageStatus.state)
      )
    })
    const treeData = computed(() => ({ ...state.pageSchema, id: 'root' }))
    const treeDataMap = computed(() => treeData2Map(treeData.value))

    // 和交互有关的数据
    const treeRowData = reactive({})

    const getRowProp = (id, prop) => {
      return treeRowData[id]?.[prop]
    }

    const setRowProp = (id, prop, value) => {
      if (treeRowData[id]) {
        treeRowData[id][prop] = value
        return
      }

      treeRowData[id] = { [prop]: value }
    }

    onActivated(() => {
      state.pageSchema = filterSchema(getSchema())
    })

    // TODO 如果能优化成实时监听pageSchema，应该就不需要监听currentSchema了
    watch(
      () => pageState.currentSchema,
      (value) => {
        if (value) {
          state.pageSchema = filterSchema(getSchema())
        }
      }
    )

    const getIcon = (node) => {
      if (!node.componentName) return undefined
      const component = getMaterial(node.componentName)
      return component.icon || 'IconAssociation'
    }

    const nodeIsContainer = (node) => {
      if (node.id === 'root') {
        return true
      }

      const configure = getConfigure(node.componentName)
      return configure?.isContainer
    }

    const nodeAllowInsert = (node, scheme) => {
      if (node.id === 'root') {
        return true
      }

      return allowInsert(getConfigure(node.componentName), scheme)
    }

    watch(
      () => pageState.isLock,
      (value) => {
        state.isLock = value
      }
    )

    const highlightId = ref('')
    const highlightDepth = ref(-1)

    const treeData2Rows = (node, depth = 0, hide, highlight) => {
      const _highlight = Boolean(highlightId.value === node.id || highlight)

      if (highlightId.value === node.id) {
        highlightDepth.value = depth
      }

      let result = [{ id: node.id, depth, hide: Boolean(hide), highlight: _highlight }]
      // 如果父节点是收起的，或者隐藏，则子节点也隐藏
      const _hide = Boolean(getRowProp(node.id, 'collapse') || hide)

      for (const child of node.children || []) {
        result = result.concat(treeData2Rows(child, depth + 1, _hide, _highlight))
      }

      return result
    }

    const treeRowMap = computed(() => {
      const rows = treeData2Rows(treeData.value)

      const { rowMap } = rows.reduce(
        (result, row) => {
          // 根据index来计算top值
          if (!row.hide) {
            result.rowCount += 1
          }
          result.rowMap[row.id] = { ...row, index: result.rowCount }
          return result
        },
        { rowMap: {}, rowCount: -1 }
      )

      return rowMap
    })

    const treeRowIds = ref(Object.keys(treeRowMap.value))

    // 判断treeData是哪一种更改。树结构每一个节点有一个唯一id，比较treeData的ids和rows的ids，来判断当前变更是有增加还是删除
    const compareIdArrays = (current, previous) => {
      const previousSet = new Set(previous)
      // 交集
      const intersect = new Set(current.filter((x) => previousSet.has(x)))
      // 增加的
      const added = current.filter((x) => !intersect.has(x))
      // 删除的
      const deleted = previous.filter((x) => !intersect.has(x))

      return { preserved: [...intersect], added, deleted }
    }

    // treeData更新会触发treeDataMap更新，所以直接监听treeDataMap
    watch(treeDataMap, (value) => {
      const treeDataIds = Object.keys(value)

      const { added, deleted } = compareIdArrays(treeDataIds, treeRowIds.value)

      // 只有当有节点增加或者删除时，才会去更新treeRowIds，触发行的重新渲染
      if (added.length) {
        treeRowIds.value = treeRowIds.value.concat(added)
      }

      if (deleted.length) {
        treeRowIds.value = treeRowIds.value.filter((id) => !deleted.includes(id))
      }
    })

    const treeContainer = ref(null)
    const selectedId = ref('')
    const hoveredId = ref('')
    const isDragging = ref(false)
    const draggingPosition = ref({ x: 0, y: 0 })
    const placeholderContext = ref(null)
    const notAllowInsert = ref(false)

    let mouseDownPostion = null

    const getRowZIndex = (id) => {
      if (isDragging.value && id === selectedId.value) {
        return 1001
      }

      if (treeRowMap.value[id].hide) {
        return -1
      }

      return 1000 - treeRowMap.value[id].depth
    }

    const getRow = (elem) => {
      const id = elem.getAttribute('data-node-id')

      if (id) {
        return { id, target: elem }
      }

      if (elem.parentElement) {
        return getRow(elem.parentElement)
      }

      return null
    }

    const insertNode = (id, insertedNode, options) => {
      const { intoChild, placement } = options || {}
      const { node, parent } = treeDataMap.value[id] || {}

      if (!node) {
        return
      }

      let targetParent
      let sliceStart

      if (intoChild && nodeIsContainer(node)) {
        node.children = node.children || []
        targetParent = node
        sliceStart = 0
      } else {
        targetParent = parent
        const index = parent.children.indexOf(node)
        sliceStart = placement === 'before' ? index : index + 1
      }

      targetParent.children.splice(sliceStart, 0, insertedNode)
      setRowProp(targetParent.id, 'collapse', false)

      const selectedNode = treeDataMap.value[selectedId.value]?.node
      notAllowInsert.value = insertedNode.id === 'placeholder' && !nodeAllowInsert(targetParent, selectedNode)
    }

    const deleteNode = (id) => {
      const { node, parent } = treeDataMap.value[id] || {}

      if (!node) {
        return
      }

      const index = parent.children.indexOf(node)

      parent.children.splice(index, 1)
    }

    const getHighlightId = (focusId) => {
      const focusNode = treeDataMap.value[focusId]

      if (!focusNode) {
        return
      }

      const { node, parent } = treeDataMap.value[focusId]

      // 如果节点是容器，并且是展开状态，并且有子节点，则返回此节点；否则返回父节点
      if (nodeIsContainer(node) && !getRowProp(focusId, 'collapse') && node.children?.length) {
        return node.id
      }

      return parent?.id || ''
    }

    const handleMouseDown = (ev, id) => {
      if (state.isLock || ev.buttons !== 1) {
        return
      }

      selectedId.value = id
      highlightId.value = getHighlightId(id)
      selectNode(id, 'clickTree')
      mouseDownPostion = { x: ev.clientX, y: ev.clientY }
    }

    // cursorOffsetTop 是 cursor 相对于树容器顶部的偏移量
    const getCursorOffsetTop = (ev) => {
      const treeContainerElem = ev.currentTarget
      const treeContainerRect = treeContainerElem.getBoundingClientRect()

      const cursorOffsetTop = treeContainerElem.scrollTop - treeContainerRect.top + ev.clientY
      return cursorOffsetTop
    }

    const insertPlaceholderNode = (ev) => {
      const cursorOffsetTop = getCursorOffsetTop(ev)
      const droppedRow = getRow(ev.target)

      if (!droppedRow) {
        return
      }

      const droppedRowVerticalMidline = droppedRow.target.offsetTop + droppedRow.target.offsetHeight / 2

      if (cursorOffsetTop > droppedRowVerticalMidline) {
        insertNode(droppedRow.id, { id: 'placeholder', componentName: '' }, { placement: 'after' })
      }

      if (cursorOffsetTop < droppedRowVerticalMidline) {
        insertNode(droppedRow.id, { id: 'placeholder', componentName: '' }, { placement: 'before' })
      }

      setRowProp(selectedId.value, 'collapse', true)

      nextTick(() => {
        const target = document.querySelector('*[data-node-id="placeholder"]')
        if (target) {
          placeholderContext.value = { target, id: 'placeholder' }
          isDragging.value = true
        }
      })
    }

    const handleMouseOver = (ev, id) => {
      if (state.isLock) {
        return
      }

      hoveredId.value = id
      hoverNode(id)
    }

    const handleMouseLeave = () => {
      hoveredId.value = ''
    }

    const allowDrag = (ev) => {
      if (state.isLock || ev.buttons !== 1) {
        return false
      }

      // root节点不能拖拽
      if (selectedId.value === 'root') {
        return false
      }

      // 防抖
      if (Math.abs(ev.clientY - (mouseDownPostion?.y || 0)) < 5) {
        return false
      }

      return true
    }

    const switchRows = (draggedId, droppedId, placement) => {
      const dragged = treeDataMap.value[draggedId]
      const dropped = treeDataMap.value[droppedId]

      deleteNode(dragged.node.id)

      if (nodeIsContainer(dropped.node)) {
        // 如果是 after 并且 droppedNode 节点是展开的，则成为 droppedNode 的子节点
        if (placement === 'after' && !getRowProp(dropped.node.id, 'collapse')) {
          insertNode(dropped.node.id, dragged.node, { intoChild: true })
        } else {
          insertNode(dropped.node.id, dragged.node, { placement })
        }
      } else {
        insertNode(dropped.node.id, dragged.node, { placement })
      }
    }

    const handleSwitchRows = (target, cursorOffsetTop, offsetTop, offsetHeight) => {
      let offsetY = cursorOffsetTop - offsetTop
      if (offsetY > 0) {
        offsetY = cursorOffsetTop - (offsetTop + offsetHeight)
      }

      // 下面是交换节点逻辑
      const droppedRow = getRow(target)

      if (!droppedRow || droppedRow.id === 'root') {
        return
      }

      const droppedRowVerticalMidline = droppedRow.target.offsetTop + droppedRow.target.offsetHeight / 2

      if (offsetTop < droppedRow.target.offsetTop && cursorOffsetTop > droppedRowVerticalMidline) {
        switchRows(placeholderContext.value.id, droppedRow.id, 'after')
      }

      if (offsetTop > droppedRow.target.offsetTop && cursorOffsetTop < droppedRowVerticalMidline) {
        switchRows(placeholderContext.value.id, droppedRow.id, 'before')
      }
    }

    const handleMouseMove = (ev) => {
      if (!allowDrag(ev)) {
        return
      }

      if (!treeDataMap.value['placeholder']) {
        insertPlaceholderNode(ev)
        return
      }

      if (!placeholderContext.value) {
        return
      }

      highlightId.value = getHighlightId('placeholder')
      draggingPosition.value = { x: ev.clientX, y: ev.clientY }

      const cursorOffsetTop = getCursorOffsetTop(ev)

      const { offsetTop, offsetHeight } = placeholderContext.value.target

      if (offsetTop <= cursorOffsetTop && cursorOffsetTop <= offsetTop + offsetHeight) {
        return
      }

      handleSwitchRows(ev.target, cursorOffsetTop, offsetTop, offsetHeight)
    }

    const handleMouseUp = () => {
      if (state.isLock) {
        return
      }

      if (treeDataMap.value['placeholder']) {
        if (!notAllowInsert.value) {
          switchRows(selectedId.value, 'placeholder', 'after')
        }

        deleteNode('placeholder')

        // TODO 是否有更好的方法
        useCanvas().initData(state.pageSchema, pageState.currentPage)
        useHistory().addHistory()

        setTimeout(() => {
          if (selectedId.value) {
            highlightId.value = getHighlightId(selectedId.value)
            selectNode(selectedId.value, 'clickTree')
          }
        }, 0)
      }

      placeholderContext.value = null
      isDragging.value = false
      mouseDownPostion = null
      notAllowInsert.value = false
    }

    document.addEventListener('mouseup', handleMouseUp)

    const handleExpand = (id) => {
      const collapse = !getRowProp(id, 'collapse')
      setRowProp(id, 'collapse', collapse)

      if (collapse) {
        highlightId.value = getHighlightId(id)
      } else if (!collapse && treeDataMap.value[id].node.children?.length) {
        highlightId.value = id
      }
    }

    const clipboardData = new DataTransfer()

    const clipboardEventTypeMap = {
      KeyC: 'copy',
      KeyV: 'paste',
      KeyX: 'cut'
    }

    const handleKeyDown = (ev) => {
      if (state.isLock || !treeContainer.value || !selectedId.value) {
        return
      }

      const clipboardEventType = clipboardEventTypeMap[ev.code]
      if (ev.ctrlKey && clipboardEventType) {
        // 让指定元素手动触发剪切板事件
        treeContainer.value.dispatchEvent(new ClipboardEvent(clipboardEventType, { clipboardData }))
        return
      }

      if (ev.code === 'Delete') {
        // TODO 换个函数名称
        handlerDelete({ schema: treeDataMap.value[selectedId.value].node })
        selectedId.value = ''
        highlightId.value = ''
        return
      }
    }

    const handleClipboardEvent = (ev) => {
      handlerClipboardEvent(ev)
    }

    const showVisibilityToggle = (id) => {
      if (isDragging.value || id === 'root') {
        return false
      }

      return hoveredId.value === id || getRowProp(id, 'hide')
    }

    const toggleVisibility = (id) => {
      const hide = !getRowProp(id, 'hide')
      setRowProp(id, 'hide', hide)
      pageState.nodesStatus[id] = !hide
      getRenderer().setCondition(id, !hide)
      clearSelect()
    }

    return {
      state,
      getIcon,
      PLUGIN_NAME,
      treeContainer,
      nodeIsContainer,
      treeDataMap,
      treeRowIds,
      treeRowMap,
      getRowProp,
      selectedId,
      highlightDepth,
      isDragging,
      draggingPosition,
      notAllowInsert,
      getRowZIndex,
      handleMouseDown,
      handleMouseOver,
      handleMouseLeave,
      handleMouseMove,
      handleKeyDown,
      handleExpand,
      handleClipboardEvent,
      showVisibilityToggle,
      toggleVisibility
    }
  }
}
</script>

<style lang="less" scoped>
.outlinebox {
  height: 100%;
  overflow: hidden;
  .tree-wrap {
    height: calc(100% - 38px);
    overflow-y: scroll;
    position: relative;
    user-select: none;
    outline: none;
  }
}

.tree-grabbing {
  cursor: grabbing;
}

.tree-row-hover > :hover {
  background-color: var(--ti-lowcode-common-component-hover-bg);
}

.tree-row {
  width: 100%;
  height: 28px;
  position: absolute;
  display: flex;
  align-items: center;
  padding-left: 12px;
  flex-wrap: nowrap;
  overflow: hidden;
  align-items: center;
  color: var(--ti-lowcode-tree-color);
  background-color: var(--ti-lowcode-common-component-bg);

  & > * {
    flex-shrink: 0;
  }

  &.transition {
    transition-property: top;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 150ms;
  }

  &.dragging {
    color: var(--ti-lowcode-tree-dragged-color);
    background-color: var(--ti-lowcode-tree-dragged-bg);
    &:hover {
      background-color: var(--ti-lowcode-tree-dragged-bg);
    }
  }

  &.selected {
    background-color: var(--ti-lowcode-tree-selected-bg);

    &:hover {
      background-color: var(--ti-lowcode-tree-selected-bg);
    }
  }

  & > .row-label {
    margin-left: 4px;
  }

  & > .placeholder {
    flex: 1;
    height: 28px;
    border: 1px dashed var(--ti-lowcode-base-prompt-color);

    &.error {
      background-color: rgba(242, 48, 48, 0.1);
      border: 1px dashed var(--ti-lowcode-base-error-color);
    }
  }

  & > .eye-tool {
    position: absolute;
    right: 12px;
    display: flex;
    align-items: center;

    & > svg {
      width: 16px;
      height: 16px;
    }
  }

  & .collapse {
    transform: rotate(-90deg);
  }

  & .polyline {
    stroke: var(--ti-lowcode-tree-polyline-color);

    &.highlight {
      stroke: var(--ti-lowcode-tree-highlight-color);
    }
  }
}

.popup-label {
  height: 24px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  padding: 0 12px;
  position: fixed;
  pointer-events: none;
  background-color: var(--ti-lowcode-tree-popup-label-bg);
  z-index: 1002;
}

.icon-transition {
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

.visibility-hidden {
  visibility: hidden;
}
</style>
