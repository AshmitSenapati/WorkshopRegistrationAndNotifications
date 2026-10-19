import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema(
  {
    registrationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    workshopId: {
      type: String,
      required: true,
      index: true,
    },
    memberId: {
      type: String,
      required: true,
      index: true,
    },
    destination: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

// Database-level unique compound index on workshop identifier and member identifier
registrationSchema.index({ workshopId: 1, memberId: 1 }, { unique: true });

registrationSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj._id;
  return obj;
};

export const Registration = mongoose.model('Registration', registrationSchema);
export default Registration;
