// Vue.js
import { createApp } from 'vue';

// Quasar
import { Quasar, iconSet, QMarkdown } from '@/plugins/quasar';

// App
import App from '@/App.vue';

// create the root component
const app = createApp(App);

// use the quasar
app.use(Quasar, {
  iconSet,
});

// add the qmarkdown component
app.component('QMarkdown', QMarkdown);

// mount the app
app.mount('#app');
