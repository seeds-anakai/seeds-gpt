// Vue.js
import { createApp } from 'vue';

// Quasar
import { Quasar, iconSet } from '@/plugins/quasar';

// App
import App from '@/App.vue';

// create the root component
const app = createApp(App);

// use the quasar
app.use(Quasar, {
  iconSet,
});

// mount the app
app.mount('#app');
