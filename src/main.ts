import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { registerServiceWorker } from './lib/push.ts';

mount(App, { target: document.getElementById('app')! });

void registerServiceWorker();
