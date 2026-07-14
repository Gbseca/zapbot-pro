import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTextWithConfirmation } from './humanizer.js';

test('delivery recovery preserves an inbound LID instead of forcing the phone route', async () => {
  const sends = [];
  const refreshes = [];
  const resets = [];
  let sequence = 0;
  const wa = {
    async sendMessage(target, _text, _image, options) {
      sequence += 1;
      sends.push({ target, options });
      return { status: 'accepted', messageId: `message-${sequence}`, resolvedJid: target };
    },
    async waitForOutboundFinal(messageId) {
      return messageId === 'message-3'
        ? { status: 'confirmed', targetResolved: '193768103915999@lid', ackStatus: 3 }
        : { status: 'delivery_timeout', targetResolved: '193768103915999@lid', ackStatus: 1 };
    },
    async refreshDevicesForTarget(target, options) {
      refreshes.push({ target, options });
      return { deviceCount: 1 };
    },
    async resetSignalSessionsForTarget(target, options) {
      resets.push({ target, options });
      return { purged: 0 };
    },
  };

  const lidJid = '193768103915999@lid';
  const result = await sendTextWithConfirmation(wa, lidJid, 'Resposta de teste', {
    allowRawLid: true,
    forcePhoneJid: false,
    routeLabel: 'agent_inbound_lid',
  });

  assert.equal(result.status, 'confirmed');
  assert.equal(sends.length, 3);
  assert.ok(sends.every((attempt) => attempt.target === lidJid));
  assert.ok(sends.every((attempt) => attempt.options.forcePhoneJid === false));
  assert.ok(sends.every((attempt) => attempt.options.allowRawLid === true));
  assert.deepEqual(sends.map((attempt) => attempt.options.routeLabel), [
    'agent_inbound_lid',
    'agent_inbound_lid_fresh_lid',
    'agent_inbound_lid_peer_lid',
  ]);
  assert.deepEqual(refreshes[0], {
    target: lidJid,
    options: { forcePhoneJid: false, allowRawLid: true },
  });
  assert.deepEqual(resets[0], {
    target: lidJid,
    options: { forcePhoneJid: false, allowRawLid: true },
  });
});

test('an authoritative inbound LID is sent only once when confirmation is delayed', async () => {
  const sends = [];
  const lidJid = '193768103915998@lid';
  const wa = {
    async sendMessage(target, _text, _image, options) {
      sends.push({ target, options });
      return { status: 'accepted', messageId: 'message-once', resolvedJid: target };
    },
    async waitForOutboundFinal() {
      return { status: 'delivery_timeout', targetResolved: lidJid, ackStatus: 1 };
    },
    async refreshDevicesForTarget() {
      throw new Error('recovery should not run');
    },
    async resetSignalSessionsForTarget() {
      throw new Error('recovery should not run');
    },
  };

  const result = await sendTextWithConfirmation(wa, lidJid, 'Resposta unica', {
    allowRawLid: true,
    forcePhoneJid: false,
    disableDeliveryRecovery: true,
    routeLabel: 'agent_inbound_lid',
  });

  assert.equal(result.status, 'accepted_unconfirmed');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].target, lidJid);
});
