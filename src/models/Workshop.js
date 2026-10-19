import mongoose from 'mongoose';

const workshopSchema = new mongoose.Schema(
  {
    workshopId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    organizerId: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'cancelled'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: '__v',
  }
);

workshopSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj._id;
  delete obj.__v;
  return obj;
};

export const Workshop = mongoose.model('Workshop', workshopSchema);
export default Workshop;
