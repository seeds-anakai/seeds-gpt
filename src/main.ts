// Vue.js
import { createApp } from 'vue';

// Quasar
import { Quasar, QMarkdown, lang, iconSet } from '@/plugins/quasar';

// App
import App from '@/app.vue';

// create the root component
const app = createApp(App);

// use the quasar
app.use(Quasar, {
  lang,
  iconSet,
});

// add the qmarkdown component
app.component('QMarkdown', QMarkdown);

// mount the app
app.mount('#app');
