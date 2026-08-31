import './styles.css';
import { startWorkspace } from './ui';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing.');

void startWorkspace(root);
