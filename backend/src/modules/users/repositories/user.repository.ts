import { Types } from "mongoose";
import { UserDocument, UserModel } from "../models/user.model";

export class UserRepository {
  async create(payload: Pick<UserDocument, "name" | "email">): Promise<UserDocument> {
    return UserModel.create(payload);
  }

  async findAll(): Promise<UserDocument[]> {
    return UserModel.find().sort({ createdAt: -1 });
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email: email.toLowerCase() });
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return UserModel.findById(id);
  }

  async updateById(
    id: string,
    payload: Partial<Pick<UserDocument, "name" | "email">>,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return UserModel.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  }

  async deleteById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return UserModel.findByIdAndDelete(id);
  }
}
