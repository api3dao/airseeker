export const getUnixTimestamp = (dateString: string) => Math.floor(Date.parse(dateString) / 1000);
