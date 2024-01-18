import { headers } from "next/headers";
import { NextResponse } from "next/server";

import crypto from 'crypto';

import prismadb from "@/lib/prismadb";

import { verifyTranaction, verifySignature } from "@/lib/paystack";


const paystackevent = {
    "event": "charge.success",
    "data": {
        "id": 302961,
        "domain": "live",
        "status": "success",
        "reference": "qTPrJoy9Bx",
        "amount": 10000,
        "ip_address": "41.242.49.37",
        "metadata": 0,
        "log": {
            "time_spent": 16,
            "attempts": 1,
            "authentication": "pin",
            "errors": 0,
            "success": false,
            "mobile": false,
            "input": [],
            "channel": null,
            "history": [
                {
                    "type": "input",
                    "message": "Filled these fields: card number, card expiry, card cvv",
                    "time": 15
                },
                {
                    "type": "action",
                    "message": "Attempted to pay",
                    "time": 15
                },
                {
                    "type": "auth",
                    "message": "Authentication Required: pin",
                    "time": 16
                }
            ]
        },
        "fees": null,
        "customer": {
            "id": 68324,
            "first_name": "BoJack",
            "last_name": "Horseman",
            "email": "bojack@horseman.com",
            "customer_code": "CUS_qo38as2hpsgk2r0",
            "phone": null,
            "metadata": null,
            "risk_action": "default"
        },
        "authorization": {
            "authorization_code": "AUTH_f5rnfq9p",
            "bin": "539999",
            "last4": "8877",
            "exp_month": "08",
            "exp_year": "2020",
            "card_type": "mastercard DEBIT",
            "bank": "Guaranty Trust Bank",
            "country_code": "NG",
            "brand": "mastercard",
            "account_name": "BoJack Horseman"
        },
        "plan": {}
    }
}

export async function POST(req: Request) {
    try {
        const signature = headers().get("x-paystack-signature") as string;
        const body: any = req.body;
        const data = body.data;

        if (!verifySignature(body, signature)) {
            return new NextResponse("Incorrect Signature", { status: 400 });
        }

        if (body?.event === 'charge.success') {
            let userSub;

            const status = data.status;
            const authorization_code = data?.authorization?.authorization_code;
            const transactionId = data?.id;

            if (!data?.metadata?.userId) {
                return new NextResponse("User ID is required", { status: 400 });
            }

            //check if the user has subscription 
            userSub = await prismadb.userSubscription.findUnique({
                where: {
                    userId: data.metadata.userId,
                }
            });

            //Add sub if none exist
            if (!userSub && status === 'success') {
                userSub = await prismadb.userSubscription.create({
                    data: {
                        paystackCustomerId: data?.customer?.id.toString(),
                        paystackCustomerCode: data?.customer?.customer_code,
                        paystackaAuthorizationCode: data?.authorization?.authorization_code,
                        planCode: data?.plan,
                        isActive: true,
                        userId: data.metadata.userId,
                    },
                });
            } else if (userSub && status === 'success') {
                userSub = await prismadb.userSubscription.update({
                    where: {
                        userId: data.metadata.userId,
                        paystackCustomerCode: data?.customer?.customer_code,
                    },
                    data: {

                        planCode: data?.plan,
                        isActive: true,
                        userId: data.metadata.userId,
                    },
                });
            }
            // Get the transaction stub created at initialization
            const transactionSummary = await prismadb.paymentTransactionDetail.findUnique({
                where: {
                    userId: data.metadata.userId,
                    reference: data?.reference,
                },
            });

            // This should already exist in the database from transaction initialization
            if (!transactionSummary) {
                return new NextResponse("Transaction was not initiated properly.", { status: 400 });
            } else {
                // update the transaction summary
                await prismadb.paymentTransactionDetail.update({
                    where: {
                        reference: data?.reference,
                        userId: data?.metadata?.userId,
                    },
                    data: {
                        authorization_code,
                        transactionId,
                        customerId: data?.customer?.id.toString(),
                        planCode: data?.plan,
                        sourceIPAddress: data?.ip_addres,
                        transactionPaidAt: data?.paidAt,
                        transactionCreatedAt: data?.createdAt,
                        isCompleted: status === "success" ? true : false,
                    },
                });
            };

            return new NextResponse(null, { status: 200 });
        }

        if (body?.event === "subscription.create") {
            // A subscription.create event is sent to indicate that a subscription was created for the 
            // customer who was charged.
            let userSub;

            //check if the user has subscription 
            userSub = await prismadb.userSubscription.findUnique({
                where: {
                    userId: data.metadata.userId,
                }
            });

            // Create a new subscription if none exists
            if (!userSub && data?.status === "active") {
                userSub = await prismadb.userSubscription.create({
                    data: {
                        paystackCustomerId: data?.customer?.id.toString(),
                        paystackCustomerCode: data?.customer?.customer_code,
                        paystackaAuthorizationCode: data?.authorization?.authorization_code,
                        paystackSubscriptionCode: data?.subscription_code,
                        planCode: data?.plan?.plan_code,
                        nextPaymentDate: data?.next_payment_date,
                        isActive: true,
                        userId: data.metadata.userId,
                    },
                });
            } else if (userSub && data?.status === "active") { // update if it already exists
                userSub = await prismadb.userSubscription.update({
                    where: {
                        userId: data.metadata.userId,
                        paystackCustomerCode: data?.customer?.customer_code,
                        planCode: data?.plan?.plan_code,
                    },
                    data: {
                        isActive: true,
                        nextPaymentDate: data?.next_payment_date,
                        paystackSubscriptionCode: data?.subscription_code,
                        paystackaAuthorizationCode: data?.authorization?.authorization_code,
                    },
                });
            }

            return new NextResponse(null, { status: 200 });
        }

        if (body?.event == "subscription.expiring_cards") {
            // At the beginning of each month, paystack will send a subscription.expiring_cards webhook, 
            // which contains information about all subscriptions with cards that expire that month. 
            // You can use this to proactively reach out to your customers, and have them update the card
            // on their subscription.

            const event_resp = {
                "event": "subscription.expiring_cards",
                "data": [
                    {
                        "expiry_date": "12/2021",
                        "description": "visa ending with 4081",
                        "brand": "visa",
                        "subscription": {
                            "id": 94729,
                            "subscription_code": "SUB_lejj927x2kxciw1",
                            "amount": 44000,
                            "next_payment_date": "2021-11-11T00:00:01.000Z",
                            "plan": {
                                "interval": "monthly",
                                "id": 22637,
                                "name": "Premium Service (Monthly)",
                                "plan_code": "PLN_pfmwz75o021slex"
                            }
                        },
                        "customer": {
                            "id": 7808239,
                            "first_name": "Bojack",
                            "last_name": "Horseman",
                            "email": "bojackhoresman@gmail.com",
                            "customer_code": "CUS_8v6g420rc16spqw"
                        }
                    }
                ]
            }

            return new NextResponse(null, { status: 200 });
        }

        return new NextResponse(null, { status: 400 });
    } catch (error) {
        return new NextResponse(null, { status: 400 });
    }
}