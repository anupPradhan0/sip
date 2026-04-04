import { NextFunction, Request, Response } from "express";
import { UserService } from "../services/user.service";
import { parseWithSchema } from "../../../utils/zod-validate";
import { createUserSchema, updateUserSchema, userIdParamSchema } from "../validators/user.schema";

const userService = new UserService();

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = parseWithSchema(createUserSchema, req.body);
    const user = await userService.createUser(payload);

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function getUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const users = await userService.getUsers();
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

export async function getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = parseWithSchema(userIdParamSchema, req.params);
    const user = await userService.getUserById(id);
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = parseWithSchema(userIdParamSchema, req.params);
    const payload = parseWithSchema(updateUserSchema, req.body);
    const user = await userService.updateUser(id, payload);
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = parseWithSchema(userIdParamSchema, req.params);
    await userService.deleteUser(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
