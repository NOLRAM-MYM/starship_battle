/**
 * Loop de envio de input. Faz polling do InputController e envia
 * ClientMsg::Input a 30Hz (30 vezes por segundo) pelo NetClient.
 *
 * O loop também mede o RTT via Ping/Pong.
 */

import type { NetClient } from '../net/client';
import type { InputController } from './keyboard';

export interface InputLoopHandle {
  stop(): void; // Stop the loop
}

export function startInputLoop(
  net: NetClient,
  input: InputController,
  rateHz = 30,
): InputLoopHandle {
  const periodMs = 1000 / rateHz;
  let pingCounter = 0;
  let lastPingAt = 0;

  const timer = setInterval(() => {
    // Coleta snapshot e envia.
    const snap = input.read();
    net.send({
      type: 'Input',
      payload: {
        steer: snap.steer,
        pitch: snap.pitch,
        roll: snap.roll,
        thrust: snap.thrust,
        fire: snap.fire,
        fireCharge: snap.fireCharge,
        skill: snap.skill,
      },
    });

    // Ping/Pong a cada ~1s para medir RTT.
    const now = performance.now();
    if (now - lastPingAt > 1000) {
      lastPingAt = now;
      pingCounter = (pingCounter + 1) | 0;
      net.send({ type: 'Ping', payload: { nonce: pingCounter } });
    }
  }, periodMs);

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
