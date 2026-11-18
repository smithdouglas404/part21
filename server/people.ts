import { listDomainRecords } from "./domain-store";

export type AssurancePerson = {
  id: string;
  name: string;
  title: string;
  roleId: string;
  email: string;
  organization: string;
  active: boolean;
  synthetic: true;
};

export async function listAssurancePeople(roleId?: string) {
  const people = await listDomainRecords<AssurancePerson>("person");
  return {
    source: "mysql-domain-records",
    syntheticDirectory: true,
    people: roleId ? people.filter((person) => person.roleId === roleId && person.active) : people.filter((person) => person.active),
  };
}
