import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentRoleRegistry, RoleDefinition } from './role-registry.js';

describe('AgentRoleRegistry', () => {
  let registry: AgentRoleRegistry;
  
  beforeEach(() => {
    registry = new AgentRoleRegistry();
  });
  
  describe('loadFromConfig', () => {
    it('should load roles from config', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code', 'implement', 'viết code', 'lập trình']
        },
        {
          id: 'researcher',
          description: 'Finds information',
          defaultPrompt: 'You are a researcher',
          canDelegate: false,
          keywords: ['research', 'find', 'tìm hiểu', 'tìm kiếm']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      expect(registry.getRole('coder')).toBeDefined();
      expect(registry.getRole('researcher')).toBeDefined();
      expect(registry.getRole('leader')).toBeUndefined();
    });
    
    it('should clear existing roles before loading', () => {
      const roles1: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code']
        }
      ];
      
      const roles2: RoleDefinition[] = [
        {
          id: 'researcher',
          description: 'Finds information',
          defaultPrompt: 'You are a researcher',
          canDelegate: false,
          keywords: ['research']
        }
      ];
      
      registry.loadFromConfig(roles1);
      registry.loadFromConfig(roles2);
      
      expect(registry.getRole('coder')).toBeUndefined();
      expect(registry.getRole('researcher')).toBeDefined();
    });
  });
  
  describe('getRole', () => {
    it('should return role by id', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      const role = registry.getRole('coder');
      expect(role).toBeDefined();
      expect(role?.id).toBe('coder');
    });
    
    it('should return undefined for unknown role', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      const role = registry.getRole('researcher');
      expect(role).toBeUndefined();
    });
  });
  
  describe('classifyTask', () => {
    it('should classify task by English keywords', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code', 'implement', 'build', 'fix', 'debug']
        },
        {
          id: 'researcher',
          description: 'Finds information',
          defaultPrompt: 'You are a researcher',
          canDelegate: false,
          keywords: ['research', 'find', 'search', 'analyze']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      expect(registry.classifyTask('Implement a REST API')).toBe('coder');
      expect(registry.classifyTask('Research best practices')).toBe('researcher');
    });
    
    it('should classify task by Vietnamese keywords', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code', 'implement', 'build', 'fix', 'debug', 'viết code', 'lập trình']
        },
        {
          id: 'researcher',
          description: 'Finds information',
          defaultPrompt: 'You are a researcher',
          canDelegate: false,
          keywords: ['research', 'find', 'search', 'analyze', 'tìm hiểu', 'tìm kiếm', 'phân tích']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      expect(registry.classifyTask('Viết code cho API')).toBe('coder');
      expect(registry.classifyTask('Tìm hiểu về React')).toBe('researcher');
    });
    
    it('should be case-insensitive', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['CODE', 'IMPLEMENT', 'code', 'implement']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      expect(registry.classifyTask('CODE THIS TASK')).toBe('coder');
      expect(registry.classifyTask('Implement feature')).toBe('coder');
    });
    
    it('should return general if no keywords match', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code', 'implement']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      expect(registry.classifyTask('Hello world')).toBe('general');
    });
  });
  
  describe('getAllRoles', () => {
    it('should return all loaded roles', () => {
      const roles: RoleDefinition[] = [
        {
          id: 'coder',
          description: 'Writes code',
          defaultPrompt: 'You are a coder',
          canDelegate: false,
          keywords: ['code']
        },
        {
          id: 'researcher',
          description: 'Finds information',
          defaultPrompt: 'You are a researcher',
          canDelegate: false,
          keywords: ['research']
        }
      ];
      
      registry.loadFromConfig(roles);
      
      const allRoles = registry.getAllRoles();
      expect(allRoles.length).toBe(2);
      expect(allRoles.map(r => r.id)).toContain('coder');
      expect(allRoles.map(r => r.id)).toContain('researcher');
    });
    
    it('should return empty array if no roles loaded', () => {
      const allRoles = registry.getAllRoles();
      expect(allRoles).toEqual([]);
    });
  });
});
