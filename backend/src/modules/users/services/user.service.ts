import { ApiError } from "../../../utils/api-error";
import { UserRepository } from "../repositories/user.repository";
import { UserDocument } from "../models/user.model";

export class UserService {
  private readonly userRepository = new UserRepository();

  async createUser(payload: Pick<UserDocument, "name" | "email">): Promise<UserDocument> {
    const existingUser = await this.userRepository.findByEmail(payload.email);
    if (existingUser) {
      throw new ApiError("Email already exists", 409);
    }

    return this.userRepository.create(payload);
  }

  async getUsers(): Promise<UserDocument[]> {
    return this.userRepository.findAll();
  }

  async getUserById(id: string): Promise<UserDocument> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    return user;
  }

  async updateUser(
    id: string,
    payload: Partial<Pick<UserDocument, "name" | "email">>,
  ): Promise<UserDocument> {
    const user = await this.userRepository.updateById(id, payload);

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    return user;
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.userRepository.deleteById(id);

    if (!user) {
      throw new ApiError("User not found", 404);
    }
  }
}
