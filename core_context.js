const services = new Map();
export const context = {
    register: (name, service) => services.set(name, service),
    get: (name) => services.get(name)
};
console.log('Context loaded');
