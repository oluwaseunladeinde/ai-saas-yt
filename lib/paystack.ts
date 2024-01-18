import axios from "axios";
import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs";
import prismadb from "@/lib/prismadb";
import { createAuditLog } from "./create-audit-log";
import { ACTION, ENTITY_TYPE } from "@prisma/client";

export const MONTHLY_PRO_PLAN = 7500;
export const PRO_PLAN_CODE = "PLN_z0v7o4kxb4qj4so";
export const YEARLY_PRO_PLAN = MONTHLY_PRO_PLAN * 12;
export const authConfig = {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_API_KEY}` }
};
export const ValidIPAddresses = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];
export const InitializeTransactionUrl = `https://api.paystack.co/transaction/initialize`;
export const VerifyTransactionUrl = `https://api.paystack.co/transaction/verify/:reference`;

export const generateRefenceNumber = (reftype?: string) => {
    if (reftype === "maths") {
        return Math.floor(Math.random() * 10000000000 + 1)
    } else if (reftype === "mathsdate") {
        return Math.floor(Math.random() * Date.now()).toString(16);
    } else {
        return randomUUID().toString();
    }
}

export const verifySignature = (eventData: any, signature: string): boolean => {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha512', process.env.PAYSTACK_TEST_SECREY_API_KEY);
    const expectedSignature = hmac.update(JSON.stringify(eventData)).digest('hex');
    return expectedSignature === signature;
}

export const checkUserSubscription = async () => {

    const { userId } = auth();
    if (!userId) { return false; }

    const userSub = await prismadb.userSubscription.findUnique({
        where: {
            userId,
        },
    });
    if (userSub && userSub.isActive) {
        return true;
    }
    else {
        return false;
    }
}


export const getCustomerSummary = async (customerCode: string) => {
    const paystackFetchCustomerURL = `https://api.paystack.co/customer/${customerCode}`;
    const response = await axios.get(paystackFetchCustomerURL, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_API_KEY}` } });
    const data = response.data.data;

    console.log({ data, subscriptions: data.subscriptions, authorizations: data.authorizations });
}

export const verifyTranaction = async (transref: string) => {

    let verified = false;

    try {
        const paystackVerifyURL = `https://api.paystack.co/transaction/verify/${transref}`;
        const response = await axios.get(paystackVerifyURL, { headers: { Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET_API_KEY}` } });
        const data = response.data.data;

        console.log({ data, metadata: data.metadata, subscriptions: data.subscriptions });

        if (data?.status !== 'success') {
            return false;
        }

        let userSub;
        const metadata = data.metadata;
        const reference = data?.reference;
        const status = data.status;
        const authorization_code = data?.authorization?.authorization_code;
        const transactionId = data?.id;
        const customerId = data?.customer?.id;
        const planCode = data?.plan;
        const sourceIPAddress = data?.ip_address;

        //check if the user has subscription 
        userSub = await prismadb.userSubscription.findUnique({
            where: {
                userId: metadata.userId,
            }
        });

        //Add sub if none exist
        if (!userSub && status === 'success') {
            userSub = await prismadb.userSubscription.create({
                data: {
                    paystackCustomerId: customerId.toString(),
                    paystackCustomerCode: data?.customer?.customer_code,
                    planCode: planCode,
                    isActive: true,
                    userId: metadata.userId,
                },
            });
        }

        // Get the transaction stub created at initialization
        const transactionSummary = await prismadb.paymentTransactionDetail.findUnique({
            where: {
                userId: metadata.userId,
                reference,
            },
        });

        // This should already exist in the database from transaction initialization
        if (!transactionSummary) {
            return false;
        } else {
            // update the transaction summary
            const paydetail = await prismadb.paymentTransactionDetail.update({
                where: {
                    reference,
                    userId: metadata.userId,
                },
                data: {
                    authorization_code,
                    transactionId,
                    customerId,
                    planCode,
                    sourceIPAddress,
                    transactionPaidAt: data?.paidAt,
                    transactionCreatedAt: data?.createdAt,
                    isCompleted: status === "success" ? true : false,
                },
            });

            await createAuditLog({
                entityId: paydetail.id,
                entityTitle: paydetail?.reference!,
                entityType: ENTITY_TYPE.PAYMENT,
                action: ACTION.SUBSCRIBE,
            });
        };

        return true;
    } catch (error) {
        console.log({ error });
    }
    return false;
}