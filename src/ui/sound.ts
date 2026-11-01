import { store } from './store';
import { audio } from '../audio/engine';

/** Sound on/off (header button and the M key). Turning it on is a user gesture, so audio can start right away. */
export function toggleSound() {
  store.mutate((x) => { x.settings.sound = !x.settings.sound; });
  audio.configure(store.state.settings.sound, store.state.settings.audio);
  if (store.state.settings.sound) { audio.unlock(); audio.play('card.snap'); }
}
