import mongoose from 'mongoose';

const notificationJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['registration_confirmation', 'workshop_cancellation'],
      required: true,
      index: true,
    },
    workshopId: {
      type: String,
      required: true,
      index: true,
    },
    registrationId: {
      type: String,
      default: null,
      index: true,
    },
    recipientId: {
      type: String,
      required: true,
      index: true,
    },
    destination: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'dead_lettered'],
      default: 'pending',
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes supporting efficient polling of pending/due jobs and expired leases
notificationJobSchema.index({ status: 1, nextAttemptAt: 1 });
notificationJobSchema.index({ status: 1, leaseExpiresAt: 1 });
notificationJobSchema.index({ workshopId: 1, eventType: 1, recipientId: 1 });

notificationJobSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj._id;
  return obj;
};

export const NotificationJob = mongoose.model('NotificationJob', notificationJobSchema);
export default NotificationJob;
