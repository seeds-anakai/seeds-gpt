// Pinia
import { createPinia } from 'pinia';

// Persistedstate
import { createPersistedState } from 'pinia-plugin-persistedstate';

// create pinia
const pinia = createPinia();

// use the persistedstate
pinia.use(createPersistedState({
  auto: true,
}));

export default pinia;
