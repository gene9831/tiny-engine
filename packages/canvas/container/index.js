import metaData from './meta'
import CanvasContainer from './src/CanvasContainer.vue'
import { useMultiSelect } from './src/composables/useMultiSelect'
import { selectState } from './src/container'

export default {
  ...metaData,
  entry: CanvasContainer,
  api: { useMultiSelect, getSelectState: () => selectState }
}
