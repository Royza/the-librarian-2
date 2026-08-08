import './ui/style.css';
import { Game } from './game.js';

const canvas = document.getElementById('scene');
const ui = document.getElementById('ui');

const game = new Game(canvas, ui);
window.__game = game;   // handy in the console; harmless in production

// Restore saved settings before anything renders.
const s = game.save.settings;
if (s.quality) game.render.setQuality(s.quality);
game.audio.setVolume(s.master);
game.audio.setMusicVolume(s.music);
game.audio.setSfxVolume(s.sfx);

// Audio contexts need a gesture; the title screen is that gesture.
const kick = () => {
  game.audio.resume();
  window.removeEventListener('pointerdown', kick);
  window.removeEventListener('keydown', kick);
};
window.addEventListener('pointerdown', kick);
window.addEventListener('keydown', kick);

game.showMenu();
