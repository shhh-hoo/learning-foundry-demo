import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      activeInstitutionId: string;
      authMethod: string;
      sessionId: string;
    };
  }

  interface User {
    activeInstitutionId: string;
    authMethod: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    activeInstitutionId?: string;
    authMethod?: string;
    sessionId?: string;
  }
}
