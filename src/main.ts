import './style.css';
import { loadRuntimeConfig } from './config';
import { startApp } from './app';

loadRuntimeConfig().then(startApp);
