import sha256 from 'crypto-js/sha256';
import jwt from "jsonwebtoken";
import { omit } from "ts-functional";
import { getAppConfig, salt, secret } from '../../../config';
import { database } from '../../core/database';
import { error403 } from '../../core/express/errors';
import { basicCrudService, basicRelationService, twoWayRelationService } from '../../core/express/service/common';
import { loadBy, loadById } from '../../core/express/util';
import { render } from "../../core/render";
import { sendEmail } from "../../core/sendEmail";
import { IProduct } from "../../store-shared/product/types";
import { IPermission } from '../../uac-shared/permissions/types';
import { IRole } from '../../uac-shared/role/types';
import { IUser, NewUser, SafeUser, UserUpdate } from '../../uac-shared/user/types';
import { ForgotPassword } from "../components/forgotPassword";
import { ForgotUsername } from "../components/forgotUsername";

const makeSafe = (user:IUser):SafeUser => omit<IUser, "passwordHash">("passwordHash")(user) as SafeUser;
const removePassword = omit<Partial<UserUpdate>, "password">("password");

// TODO: Figure out the type for this
//const hashUserPassword = (user:NewUser | UserUpdate):Partial<IUser> => user.password
const hashUserPassword = (user:any):any => user.password
    ? {...removePassword(user), passwordHash: sha256(salt + user.password).toString() }
    : removePassword(user);

const assignDefaultRole = async (user:IUser) => {
    const roleId = getAppConfig().defaultUserRoleId;
    await User.roles.add(user.id, roleId);
}

const db = database();

export const User = {
    ...basicCrudService<IUser, NewUser, UserUpdate, SafeUser>("users", "userName", makeSafe, hashUserPassword, hashUserPassword, assignDefaultRole),
    loadUnsafe:       loadById<IUser>("users"),
    loadUnsafeByName: loadBy<IUser>("userName", "users"),

    roles: basicRelationService<IRole>("userRoles", "userId", "roles", "roleId"),
    permissions: twoWayRelationService<IPermission>("userId", "roleId", "permissionId", "userRoles", "rolePermissions", "permissions"),
    wishlists: basicRelationService<IProduct>("wishlists", "userId", "products", "productId"),

    getLoggedInUser: (token:string):string | null => {
        console.log(token);
        if(!token) return null;
        const userId = jwt.verify(token, secret) as string;
        return userId;
    },

    makeSafe: (user:IUser):SafeUser => omit<IUser, "passwordHash">("passwordHash")(user) as SafeUser,
    hashPassword: (str:string) => sha256(salt + str).toString(),

    forgotPassword: async (userName:string):Promise<any> => {
        // Generate a key for the reset password link
        const token = jwt.sign({userName}, secret, {expiresIn: "1h"});

        // Send an email with the link via AWS SES
        const html = render(ForgotPassword, {userName, token});

        const user = await User.loadBy("userName")(userName);

        sendEmail(getAppConfig().emailTemplates.forgotPassword.subject, html, [user.email]);
    },

    createPasswordResetToken: async (userName:string):Promise<string> => {
        return jwt.sign({userName}, secret, {expiresIn: "1h"});
    },

    forgotUserName: async (email:string):Promise<any> => {
        const user = await User.loadBy("email")(email);
    
        if(!user) {
            return;
        }

        // Get the forgot username template
        const html = render(ForgotUsername,  {email, userName: user.userName});
        sendEmail(getAppConfig().emailTemplates.forgotUserName.subject, html, [email]);

    },

    resetPassword: async (token:string, newPassword: string):Promise<any> => {
        // Verify the token
        const {userName} = jwt.verify(token, secret) as {userName: string};

        if(!userName) {
            throw error403;
        }

        // Update the user with the new password
        await db("users")
            .update({passwordHash: User.hashPassword(newPassword)})
            .where({userName});
    }
};
