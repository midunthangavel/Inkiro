'use strict';

/**
 * Socket.IO event name constants.
 *
 * Room conventions:
 *   shop:{shopId}     — joined by shop dashboard on connect
 *   runner:{runnerId} — joined by runner app on connect
 *
 * Emission targets are documented per event below.
 */
const EVENTS = Object.freeze({
  // Emitted to: all rooms in order.broadcast_shop_ids
  // When: new order confirmed by customer and shops are within radius
  ORDER_NEW: 'order:new',

  // Emitted to: all broadcast shop rooms EXCEPT the one that accepted
  // When: one shop accepts the order (others should remove the card)
  ORDER_TAKEN: 'order:taken',

  // Emitted to: each nearby runner's room individually
  // When: shop accepts order and available runners are identified
  JOB_AVAILABLE: 'job:available',

  // Emitted to: the accepting shop's room
  // When: a runner confirms acceptance of the delivery job
  RUNNER_ASSIGNED: 'runner:assigned',

  // Emitted to: the accepting shop's room
  // When: runner marks the order as picked up at the shop
  ORDER_PICKED_UP: 'order:picked_up',

  // Emitted to: the recipient's room (shop/runner/customer)
  // When: a chat message is sent in a conversation
  MESSAGE_NEW: 'message:new',

  // Emitted to: the sender's room
  // When: recipient marks messages as read
  MESSAGE_READ: 'message:read',
});

module.exports = EVENTS;
