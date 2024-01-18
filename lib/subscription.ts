import { auth } from "@clerk/nextjs";

import prismadb from "@/lib/prismadb";

const DAY_IN_MS = 86_400_000;

export const checkSubscription = async () => {
    const { userId } = auth();

    if (!userId) {
        return false;
    }

    const userSubscription = await prismadb.userSubscription.findUnique({
        where: {
            userId: userId,
        },
        select: {
            paystackSubscriptionCode: true,
            paystackPeriodEnd: true,
            paystackCustomerId: true,
            isActive: true,
        },
    })

    if (!userSubscription) {
        return false;
    }

    const subPeriodEnd = new Date(userSubscription.paystackPeriodEnd!);

    const isValid =
        userSubscription.isActive &&
        subPeriodEnd?.getTime()! + DAY_IN_MS > Date.now()

    return !!isValid;
};