"use strict";

const fs = require('fs');
const path = require('path');
const co = require('bluebird-co');
const glob = require('glob');
const Promise = require('bluebird');
const fsCo = require('co-fs');


var swig = require('swig');
var marked = require('marked');
var frontMatter = require('front-matter');

const helpers = {
  destinationPath(settings, link) {
    if(!link) {
      throw new Error('link not defined: ' + link);
    }

    if(link == "index") {
      link += ".html";
    }

    if((link.charAt(link.length - 1) == '/')) {
      link += "index.html";
    }

    if(path.basename(link, '.html') == path.basename(link)) {
      link += "/index.html";
    }

    return path.join(settings.dest, path.dirname(link), path.basename(link, '.html') + ".html");
  },

  globPath(pattern) {
    return new Promise((resolve, reject) => {
      glob(pattern, (err, files) => {
        if(err) return reject(err);
        console.log('glob:', files);
        return resolve(files);
      });
    });
  },

  readFile(file, encoding) {
    return new Promise((resolve, reject) => {
      fs.readFile(file, encoding, (err, content) => {
        if(err) return reject(err);
        resolve(content);
      });
    });
  },

  writeFile: function*(settings, linkPath, content) {
    var link = this.destinationPath(settings, linkPath);
    var dirname = path.dirname(link); 
    console.log('writing page:', link);

    try {
      var exists = yield fsCo.stat(dirname);
    } catch(err) {
      yield fsCo.mkdir(dirname);
    }

    yield fsCo.writeFile(link, content);
    console.log('page-written:', link, linkPath);
  }
};

class Statist {
  constructor(site, settings, options) {
    options || (options = {});
    this.site = site || {}; 
    this.settings = settings || {};
    this.templates = {};
    this.swig = swig;

    if(options.filters && typeof options.filters === "object") {
      Object.keys(options.filters).forEach(name => {
        var filter = options.filters[name];
        console.log('Adding filter to swig:', name);
        swig.setFilter(name, filter);
      });
    }
  }

  compileTemplates(pattern) {
    return new Promise((resolve, reject) => {
      glob(pattern, (err, files) => {
        if(err) return reject(err);

        var promises = files.reduce((obj, x) => {
          var name = path.basename(x, path.extname(x));
          obj[name] = this.compileTemplate(x);
          return obj;
        }, {});

        Promise.props(promises)
          .then(templateMap => {
            Object.assign(this.templates, templateMap);
            resolve(templateMap);
          })
          .catch(err => {
            reject(err);
          });
      });
    });
  }

  compileTemplate(file) {
    return new Promise((resolve, reject) => {
      try {
        var template = this.swig.compileFile(file);
        resolve(template);
      } catch(err) {
        reject(err);
      }
    });
  }

  *writeFile(linkPath, content) {
    return yield helpers.writeFile(this.settings, linkPath, content);
  }

  *readFrontMatterMarkdownPages(pattern) {
    return yield (yield helpers.globPath(pattern).reduce((map, f) => {
      console.log('mapping front matter page:', f);
      map[f] = co.wrap(this.readFrontMatterMarkdownPage)(f);
      return map;
    }, {}));
  }

  *readFrontMatterMarkdownPage(fp) {
    var file = yield fsCo.readFile(fp, 'utf8');
    var content = frontMatter(file);
    console.log('front-matter:', content);
    var body = marked(content.body);
    var attrs = content.attributes;
    content.body = body;
    content.path = path.basename(fp, path.extname(fp));
    return content;
  }

  *compileFrontMatterMarkdownPage(path, page, context) {
    context || (context = {});

    var attrs = page.attributes;
    var template = attrs.template;

    if(!template) {
      throw new Error('missing template definition from page ' + path);
    }

    context.content = page.body;
    var rendered = yield this.renderTemplate(template, attrs, context);
    return rendered;
  }

  renderTemplate(name, page, context, template) {
    context || (context = {});
    if(!template) {
      template = this.templates[name];
    }
    return new Promise((resolve, reject) => {
      if(!template) return reject(new Error('unable to find precompiled template with name: ' + name));
      Object.assign(context, { page });
      var rendered = template(this.getDefaultTemplateContext(name, context));
      resolve(rendered);
    });
  }

  getDefaultTemplateContext(name, context) {
    return Object.assign({}, this.site, context);
  }

}

module.exports = {
  helpers,
  init(site, settings, options) {
    return new Statist(site, settings, options);
  }
};