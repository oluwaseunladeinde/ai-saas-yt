import axios from "axios";
import prismadb from "@/lib/prismadb";
import { auth, currentUser } from "@clerk/nextjs";
import {
    InitializeTransactionUrl,
    MONTHLY_PRO_PLAN,
    PRO_PLAN_CODE,
    authConfig,
    generateRefenceNumber
} from "@/lib/paystack";
import { absoluteUrl } from "@/lib/utils";
import { NextResponse } from "next/server";


const settingsUrl = absoluteUrl("/settings");

export async function GET(req: Request) {

    try {

        const { userId } = auth();
        const user = await currentUser();

        if (!userId || !user) {
            return new NextResponse("Unauthenticated", { status: 401 });
        }

        const userSubscription = await prismadb.userSubscription.findUnique({
            where: {
                userId,
            }
        })

        if (userSubscription && userSubscription.paystackCustomerId) {
            return NextResponse.json(settingsUrl);
        }

        let url = "";
        const paymentPayload = {
            email: user?.emailAddresses[0]?.emailAddress,
            amount: Math.round(MONTHLY_PRO_PLAN * 100),
            reference: generateRefenceNumber(),
            callback_url: settingsUrl,
            metadata: {
                userId,
                custom_fields: [
                    {
                        display_name: "Customer's Fullname",
                        variable_name: "customer_name",
                        value: user?.firstName + '' + user?.lastName,
                    },
                    {
                        display_name: "Application's Name",
                        variable_name: "application_name",
                        value: "Genuis App",
                    }
                ]
            },
            plan: PRO_PLAN_CODE,
        }

        const response = await axios.post(InitializeTransactionUrl, paymentPayload, authConfig);
        const response_data = response.data.data;
        await prismadb.paymentTransactionDetail.create({
            data: {
                userId: user?.id,
                access_code: response_data?.access_code,
                authorization_url: response_data?.authorization_url,
                reference: response_data?.reference,
            }
        });
        return NextResponse.json(response_data?.authorization_url);

    } catch (error) {
        console.log('[PAYSTACK_ERROR]', error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}