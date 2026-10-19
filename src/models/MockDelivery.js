import mongoose from 'mongoose';

const mockDeliverySchema = new mongoose.Schema(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    jobId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
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
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['accepted', 'deduplicated'],
      default: 'accepted',
    },
    receivedCount: {
      type: Number,
      default: 1,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    lastReceivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

mockDeliverySchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj._id;
  return obj;
};

export const MockDelivery = mongoose.model('MockDelivery', mockDeliverySchema);
export default MockDelivery;
