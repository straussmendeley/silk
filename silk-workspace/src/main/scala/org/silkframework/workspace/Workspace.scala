/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.silkframework.workspace

import java.io._
import java.util.logging.Logger

import org.silkframework.util.Identifier
import org.silkframework.workspace.resources.ResourceRepository

class Workspace(val provider: WorkspaceProvider, val repository: ResourceRepository) {

  private val logger = Logger.getLogger(classOf[Workspace].getName)

  @volatile
  private var cachedProjects = loadProjects()

  def projects: Seq[Project] = cachedProjects

  /**
   * Retrieves a project by name.
   *
   * @throws java.util.NoSuchElementException If no project with the given name has been found
   */
  def project(name: Identifier): Project = {
    findProject(name).getOrElse(throw ProjectNotFoundException(name))
  }

  private def findProject(name: Identifier): Option[Project] = {
    projects.find(_.name == name)
  }

  def createProject(config: ProjectConfig): Project = {
    if(cachedProjects.exists(_.name == config.id)) {
      throw IdentifierAlreadyExistsException("Project " + config.id + " does already exist!")
    }
    provider.putProject(config)
    val newProject = new Project(config, provider, repository.get(config.id))
    cachedProjects :+= newProject
    newProject
  }

  def removeProject(name: Identifier): Unit = {
    project(name).activities.foreach(_.control.cancel())
    provider.deleteProject(name)
    cachedProjects = cachedProjects.filterNot(_.name == name)
  }

  /**
    * Generic export method that marshals the project as implemented in the given [[ProjectMarshallingTrait]] object.
    *
    * @param name project name
    * @param outputStream the output stream to write the exported project to.
    * @param marshaller object that defines how the project should be marshaled.
    * @return
    */
  def exportProject(name: Identifier, outputStream: OutputStream, marshaller: ProjectMarshallingTrait): String = {
    marshaller.marshalProject(project(name).config, outputStream, provider, repository.get(name))
  }

  /**
    * Generic project import method that unmarshals the project as implemented in the given [[ProjectMarshallingTrait]] object.
    *
    * @param name project name
    * @param inputStream the input stream to read the project to import from
    * @param marshaller object that defines how the project should be unmarshaled.
    */
  def importProject(name: Identifier,
                    inputStream: InputStream,
                    marshaller: ProjectMarshallingTrait) {
    findProject(name) match {
      case Some(_) =>
        throw IdentifierAlreadyExistsException("Project " + name.toString + " does already exist!")
      case None =>
        marshaller.unmarshalProject(name, provider, repository.get(name), inputStream)
        reload()
    }
  }

  /**
    * Flushes this workspace. i.e., all task data is written to the workspace provider immediately.
    * It is usually not needed to call this method, as task data is written to the workspace provider after a fixed interval without changes.
    * This method forces the writing and returns after all data has been written.
    */
  def flush(): Unit = {
    for {
      project <- projects
      task <- project.allTasks
    } {
      task.flush()
    }
  }

  /**
    * Reloads this workspace.
    */
  def reload(): Unit = {
    // Write all data
    flush()
    // Stop all activities
    for{ project <- projects
         activity <- project.activities } {
      activity.control.cancel()
    }
    // Refresh workspace provider
    provider match {
      case refreshableProvider: RefreshableWorkspaceProvider => refreshableProvider.refresh()
      case _ => // Do nothing
    }
    // Reload projects
    cachedProjects = loadProjects()
  }

  /**
    * Removes all projects from this workspace.
    */
  def clear(): Unit = {
    for(project <- projects) {
      removeProject(project.config.id)
    }
  }

  private def loadProjects(): Seq[Project] = {
    for(projectConfig <- provider.readProjects()) yield {
      logger.info("Loading project: " + projectConfig.id)
      new Project(projectConfig, provider, repository.get(projectConfig.id))
    }
  }
}