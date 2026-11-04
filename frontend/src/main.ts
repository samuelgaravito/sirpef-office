import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router/index';
import '@fontsource/georama/latin-400.css';
import '@fontsource/georama/latin-400-italic.css';
import '@fontsource/georama/latin-500.css';
import '@fontsource/georama/latin-600.css';
import '@fontsource/georama/latin-700.css';
import '@fontsource/georama/latin-700-italic.css';
import './style.css';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');
