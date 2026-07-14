import test from 'node:test';
import assert from 'node:assert/strict';
import WhatsAppManager from './whatsapp.js';

const TEST_PHONE = '5511999999999';
const TEST_PHONE_JID = `${TEST_PHONE}@s.whatsapp.net`;
const TEST_LID_JID = '123456789012345@lid';

test('uses the v7 signal repository to resolve a phone number to its LID', async () => {
    const manager = new WhatsAppManager(null);
    manager.sock = {
        signalRepository: {
            lidMapping: {
                getLIDForPN: async (jid) => {
                    assert.equal(jid, TEST_PHONE_JID);
                    return TEST_LID_JID;
                },
            },
        },
        onWhatsApp: async () => [{ jid: TEST_PHONE_JID, exists: true }],
    };

    const result = await manager.preferStoredLidForTarget(TEST_PHONE);

    assert.equal(result.preferredJid, TEST_LID_JID);
    assert.equal(manager.resolveOutboundTarget(TEST_PHONE).resolvedJid, TEST_LID_JID);
});

test('maps a v7 contact whose preferred id is a LID', () => {
    const manager = new WhatsAppManager(null);

    const mapped = manager._registerSyncedContact({
        id: TEST_LID_JID,
        phoneNumber: TEST_PHONE_JID,
    });

    assert.ok(mapped >= 2);
    assert.equal(manager.resolvePhone(TEST_LID_JID), TEST_PHONE);
    assert.equal(manager.resolveOutboundTarget(TEST_PHONE).resolvedJid, TEST_LID_JID);
});

test('keeps compatibility with contacts that provide phone id and separate LID', () => {
    const manager = new WhatsAppManager(null);

    manager._registerSyncedContact({
        id: TEST_PHONE_JID,
        lid: TEST_LID_JID,
    });

    assert.equal(manager.resolvePhone(TEST_LID_JID), TEST_PHONE);
    assert.equal(manager.resolveOutboundTarget(TEST_PHONE).resolvedJid, TEST_LID_JID);
});

test('records an explicit WhatsApp rejection instead of waiting for a timeout', async () => {
    const manager = new WhatsAppManager(null);
    const target = manager.resolveOutboundTarget(TEST_PHONE);
    const accepted = manager._registerAcceptedOutbound('message', target, {
        key: {
            id: 'test-message-id',
            remoteJid: TEST_PHONE_JID,
            fromMe: true,
        },
        status: 1,
    });

    manager._handleMessagesUpdate([{
        key: { id: accepted.messageId, remoteJid: TEST_PHONE_JID },
        update: {
            status: 0,
            messageStubParameters: ['479'],
        },
    }]);

    const final = await manager.waitForOutboundFinal(accepted.messageId);
    assert.equal(final.status, 'failed');
    assert.match(final.error, /479/);
    assert.deepEqual(final.updates[0].messageStubParameters, ['479']);

    const record = manager._outboundRecords.get(accepted.messageId);
    clearTimeout(record?.cleanupTimer);
    manager._outboundRecords.delete(accepted.messageId);
});
